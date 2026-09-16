import { prisma } from "../lib/db.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { logger } from "../lib/logger.js";
import { enqueueApplicantAutomation } from "../lib/automationQueue.js";
import {
  canStartApplicantAutomation,
  isApplicantAutomationRunning,
  shouldDeferAutomation
} from "../lib/applicantAutomationLock.js";
import { getFailedScheduleIds, isScheduleBlocked } from "../lib/failedSchedules.js";
import { extractRawScheduleId, isBookableScheduleId } from "../lib/scheduleIds.js";
import { examCentersMatch, isSystemExamCenter, locationsMatch, SYSTEM_EXAM_CENTER, SYSTEM_EXAM_LOCATION, systemExamCenterDbWhere } from "../lib/examCenters.js";
import { findExamSchedule, listLiveOpenSlotsForCategory } from "../providers/iremboApplicationProvider.js";
import { isApplicantHeldForBatch } from "../lib/bulkAutomationHold.js";
import {
  assignScheduleToApplicant,
  applicantRequestedCategory,
  claimWaitingApplicantAssignment,
  clearApplicantAssignment,
  getApplicantById,
  isPickSlotApplicant,
  isWrongCategoryHold,
  listWaitingApplicants,
  scheduleMatchesApplicant
} from "./applicantService.js";
import { formatScheduleTimeLocal, sortSchedulesByPreferredTime, isOpenUpcomingSchedule, extractLicenseCategoryToken, liveIremboRowMatchesCategory } from "../lib/scheduleTime.js";

export { extractRawScheduleId } from "../lib/scheduleIds.js";

const MATCH_CONCURRENCY = Math.max(1, Math.min(Number(process.env.ESTIMATE_MATCH_CONCURRENCY || 4), 8));
const IN_FLIGHT_SEAT_STATUSES = [
  "PENDING",
  "SAVED",
  "FETCHING_PROFILE",
  "LOOKUP_COMPLETED",
  "LICENSE_VALIDATED",
  "RESERVING_SLOT",
  "SLOT_RESERVED",
  "RUNNING"
];

function formatExamTime(startDateTime) {
  return formatScheduleTimeLocal(startDateTime);
}

function isApplicantHeldByLoadedBatch(applicant) {
  if (!applicant?.batch) {
    return false;
  }
  if (applicant.batch.status === "DRAFT") {
    return true;
  }
  if (applicant.batch.status !== "SCHEDULED") {
    return false;
  }
  return new Date(applicant.batch.scheduledAt) > new Date();
}

async function mapWithPool(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), Math.max(items.length, 1));
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function loadReservedSeatCounts() {
  const rows = await prisma.applicant.groupBy({
    by: ["assignedScheduleId"],
    where: {
      assignedScheduleId: { not: null },
      status: { in: IN_FLIGHT_SEAT_STATUSES }
    },
    _count: { _all: true }
  });
  const reserved = new Map();
  for (const row of rows) {
    if (row.assignedScheduleId) {
      reserved.set(row.assignedScheduleId, row._count._all);
    }
  }
  return reserved;
}

export async function resolveBookableAssignment(schedule, options = {}) {
  const start = schedule?.startDateTime ? new Date(schedule.startDateTime) : null;
  if (!start || !schedule?.center) {
    throw new Error("Detected schedule is missing center or start time.");
  }
  if (!isSystemExamCenter(schedule.center)) {
    throw new Error(`Only ${SYSTEM_EXAM_CENTER} slots can be booked.`);
  }

  const examCenter = SYSTEM_EXAM_CENTER;
  const examDate = start;
  const examTime = formatExamTime(start);
  const location = SYSTEM_EXAM_LOCATION;
  const category = String(schedule.category || "").trim().toUpperCase();

  if (
    isBookableScheduleId(schedule.examScheduleId) &&
    Number(schedule.remainingCapacity) > 0 &&
    Number(schedule.amount) > 0 &&
    schedule.liveRow &&
    liveIremboRowMatchesCategory(schedule.liveRow, category)
  ) {
    return {
      examScheduleId: extractRawScheduleId(schedule.examScheduleId),
      examCenter,
      examDate,
      examTime: formatExamTime(schedule.startDateTime) || examTime,
      locationName: location,
      assignedScheduleId: schedule.scheduleId,
      amount: Number(schedule.amount)
    };
  }

  logger.info("Resolving live bookable scheduleID from Irembo", {
    scheduleId: schedule.scheduleId,
    category,
    center: examCenter,
    location,
    examTime
  });

  const live = await findExamSchedule({
    licenseCategory: category,
    examCenter,
    examDate,
    examTime,
    location
  });
  const liveMatches =
    examCentersMatch(live.examCenter, examCenter) &&
    (!location || locationsMatch(live.locationName, location)) &&
    isBookableScheduleId(live.examScheduleId);
  if (!liveMatches) {
    throw new Error("Could not resolve a live Irembo slot for this requested category and time.");
  }
  if (!(Number(live.remainingCapacity) > 0)) {
    throw new Error(
      `No live Irembo seats for ${schedule.category} at ${examTime}. Waiting for the next matching slot.`
    );
  }

  const amount = Number(live.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Live Irembo ${schedule.category} slot at ${examTime} has no category price. Refusing to book with a guessed amount.`
    );
  }

  return {
    examScheduleId: live.examScheduleId,
    examCenter,
    examDate,
    examTime: live.examTime || examTime,
    locationName: location,
    assignedScheduleId: schedule.scheduleId,
    amount
  };
}

export async function assignScheduleFromMonitor(applicantId, scheduleId) {
  await ensureDatabaseSchema();
  const applicant = await prisma.applicant.findUnique({ where: { id: Number(applicantId) } });
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: String(scheduleId) }
  });

  if (!schedule) {
    const error = new Error("Selected exam slot was not found in detected schedules.");
    error.statusCode = 400;
    throw error;
  }

  if (Number(schedule.remainingCapacity || 0) <= 0) {
    const error = new Error("Selected exam slot is no longer available. Choose another one.");
    error.statusCode = 400;
    throw error;
  }

  const assignment = await resolveBookableAssignment(schedule, {
    preferredExamTime: applicant?.preferredExamTime
  });

  await assignScheduleToApplicant(applicantId, assignment);
  return assignment;
}

export async function matchApplicantsToSchedule(schedule) {
  if (!schedule?.scheduleId) {
    return [];
  }
  return processAllWaitingApplicants();
}

async function returnEstimateApplicantsIfCategoryHasNoLiveSeats() {
  const inFlight = await prisma.applicant.findMany({
    where: { status: { in: ["PENDING", "RESERVING_SLOT", "SLOT_RESERVED"] } },
    include: { batch: true }
  });
  if (inFlight.length === 0) {
    return;
  }

  const liveByCategory = new Map();
  async function liveOpenCount(category) {
    if (!category) {
      return 0;
    }
    if (!liveByCategory.has(category)) {
      liveByCategory.set(
        category,
        listLiveOpenSlotsForCategory(category).then((rows) =>
          rows.filter((row) => Number(row.remainingCapacity) > 0).length
        )
      );
    }
    return liveByCategory.get(category);
  }

  for (const applicant of inFlight) {
    if (isPickSlotApplicant(applicant) || isWrongCategoryHold(applicant)) {
      continue;
    }
    const category = applicantRequestedCategory(applicant);
    const openCount = await liveOpenCount(category);
    if (openCount > 0) {
      continue;
    }
    await clearApplicantAssignment(
      applicant.id,
      `Category ${category || "this request"} is not open on Irembo. Waiting until that category is detected.`
    );
    logger.info("Returned estimate applicant because their category has no live remaining seats", {
      applicantId: applicant.id,
      category
    });
  }
}

export async function processPendingAutomations() {
  await ensureDatabaseSchema();
  await returnEstimateApplicantsIfCategoryHasNoLiveSeats();
  const pending = await prisma.applicant.findMany({
    where: { status: "PENDING" },
    orderBy: { updatedAt: "asc" }
  });

  const eligible = [];
  for (const row of pending) {
    const applicant = await getApplicantById(row.id, false);
    if (!applicant) {
      continue;
    }
    if (await isApplicantHeldForBatch(applicant.id)) {
      continue;
    }
    if (shouldDeferAutomation(applicant)) {
      continue;
    }
    if (isApplicantAutomationRunning(applicant.id)) {
      continue;
    }
    if (String(applicant.lastError || "").toLowerCase().includes("fetching citizen profile")) {
      const elapsed = Date.now() - new Date(applicant.updatedAt).getTime();
      if (elapsed < 120_000) {
        continue;
      }
    }
    if (!canStartApplicantAutomation(applicant.id)) {
      continue;
    }
    eligible.push(applicant.id);
  }

  await mapWithPool(eligible, MATCH_CONCURRENCY, async (applicantId) => {
    await enqueueApplicantAutomation(applicantId);
  });

  return pending.length;
}

export async function processAllWaitingApplicants(options = {}) {
  await ensureDatabaseSchema();
  await returnEstimateApplicantsIfCategoryHasNoLiveSeats();
  const onlyIds = Array.isArray(options.applicantIds)
    ? new Set(options.applicantIds.map((id) => Number(id)))
    : null;

  const waiting = (await listWaitingApplicants()).filter((applicant) => {
    if (onlyIds && !onlyIds.has(Number(applicant.id))) {
      return false;
    }
    if (isWrongCategoryHold(applicant)) {
      return false;
    }
    return !isApplicantHeldByLoadedBatch(applicant);
  });
  if (waiting.length === 0) {
    return [];
  }

  const openSchedules = (
    await prisma.schedule.findMany({
      where: {
        remainingCapacity: { gt: 0 },
        startDateTime: { gt: new Date() },
        ...systemExamCenterDbWhere()
      },
      orderBy: [{ startDateTime: "asc" }]
    })
  ).filter((schedule) => isOpenUpcomingSchedule(schedule) && isSystemExamCenter(schedule.center));

  const waitingCategories = [
    ...new Set(waiting.map((applicant) => applicantRequestedCategory(applicant)).filter(Boolean))
  ];
  const liveByCategory = new Map();
  await mapWithPool(waitingCategories, MATCH_CONCURRENCY, async (category) => {
    const liveSlots = await listLiveOpenSlotsForCategory(
      category,
      openSchedules.map((schedule) => schedule.startDateTime)
    );
    liveByCategory.set(category, liveSlots);
  });

  const reserved = await loadReservedSeatCounts();
  const seatsLeft = new Map();
  function rememberSeats(schedule) {
    if (seatsLeft.has(schedule.scheduleId)) {
      return;
    }
    const remaining = Number(schedule.remainingCapacity || 0);
    const held = reserved.get(schedule.scheduleId) || 0;
    seatsLeft.set(schedule.scheduleId, Math.max(0, remaining - held));
  }
  for (const schedule of openSchedules) {
    rememberSeats(schedule);
  }
  for (const liveSlots of liveByCategory.values()) {
    for (const schedule of liveSlots) {
      rememberSeats(schedule);
    }
  }

  const planned = [];
  for (const applicant of waiting) {
    const category = applicantRequestedCategory(applicant);
    if (!category) {
      continue;
    }
    const failedScheduleIds = await getFailedScheduleIds(applicant.id);
    const liveSlots = (liveByCategory.get(category) || []).filter(
      (schedule) => Number(schedule.remainingCapacity) > 0
    );
    const candidates = liveSlots.filter((schedule) => {
      if ((seatsLeft.get(schedule.scheduleId) || 0) <= 0) {
        return false;
      }
      if (isScheduleBlocked(schedule.scheduleId, failedScheduleIds) || isScheduleBlocked(schedule.examScheduleId, failedScheduleIds)) {
        return false;
      }
      return extractLicenseCategoryToken(schedule.category) === category;
    });
    const nearest = sortSchedulesByPreferredTime(candidates, applicant.preferredExamTime)[0];
    if (!nearest) {
      continue;
    }
    seatsLeft.set(nearest.scheduleId, (seatsLeft.get(nearest.scheduleId) || 1) - 1);
    planned.push({ applicant, schedule: nearest });
  }

  const assignmentCache = new Map();
  function assignmentFor(schedule) {
    const key = schedule.scheduleId;
    if (!assignmentCache.has(key)) {
      assignmentCache.set(key, resolveBookableAssignment(schedule));
    }
    return assignmentCache.get(key);
  }

  const assignments = [];
  await mapWithPool(planned, MATCH_CONCURRENCY, async ({ applicant, schedule }) => {
    try {
      const assignment = await assignmentFor(schedule);
      const claimed = await claimWaitingApplicantAssignment(applicant.id, assignment);
      if (!claimed) {
        return;
      }
      await enqueueApplicantAutomation(applicant.id, { force: true });
      assignments.push({
        applicantId: applicant.id,
        scheduleId: schedule.scheduleId,
        examTime: assignment.examTime,
        preferredExamTime: applicant.preferredExamTime || null
      });
      logger.info("Matched estimate applicant to nearest Busanza sitting", {
        applicantId: applicant.id,
        scheduleId: schedule.scheduleId,
        examScheduleId: assignment.examScheduleId,
        category: schedule.category,
        preferredExamTime: applicant.preferredExamTime || null,
        assignedExamTime: assignment.examTime
      });
    } catch (error) {
      logger.warn("Estimate match skipped", {
        applicantId: applicant.id,
        scheduleId: schedule.scheduleId,
        message: error.message
      });
    }
  });

  if (assignments.length > 0) {
    logger.info("Matched waiting applicants to nearest open schedules", { count: assignments.length });
    try {
      const { flushInMemoryAutomationQueue } = await import("../lib/automationQueue.js");
      await flushInMemoryAutomationQueue();
    } catch (error) {
      logger.warn("Could not flush automation queue after estimate match", { message: error.message });
    }
  }

  return assignments;
}

export async function tryMatchApplicantImmediately(applicantId) {
  await ensureDatabaseSchema();
  if (await isApplicantHeldForBatch(applicantId)) {
    return [];
  }
  return processAllWaitingApplicants({ applicantIds: [Number(applicantId)] });
}

export async function processDetectedSchedulesForApplicants(changes) {
  const relevant = (changes || []).some((change) =>
    ["NEW_SCHEDULE", "CAPACITY_INCREASE"].includes(change.type)
  );
  if (!relevant) {
    return [];
  }
  return processAllWaitingApplicants();
}
