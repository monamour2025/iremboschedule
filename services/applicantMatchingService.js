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
import { findExamSchedule } from "../providers/iremboApplicationProvider.js";
import { isApplicantHeldForBatch } from "../lib/bulkAutomationHold.js";
import {
  assignScheduleToApplicant,
  getApplicantById,
  listWaitingApplicants,
  scheduleMatchesApplicant
} from "./applicantService.js";
import { formatScheduleTimeLocal, sortSchedulesByPreferredTime, applicantPreferredTimeDistance, isOpenUpcomingSchedule } from "../lib/scheduleTime.js";

export { extractRawScheduleId } from "../lib/scheduleIds.js";

function formatExamTime(startDateTime) {
  return formatScheduleTimeLocal(startDateTime);
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
  const monitorGuid = extractRawScheduleId(schedule.scheduleId);

  logger.info("Resolving live bookable scheduleID from Irembo", {
    scheduleId: schedule.scheduleId,
    category: schedule.category,
    center: examCenter,
    location
  });

  let examScheduleId = isBookableScheduleId(monitorGuid) ? monitorGuid : "";
  if (!examScheduleId) {
    try {
      const live = await findExamSchedule({
        licenseCategory: schedule.category,
        examCenter,
        examDate,
        examTime,
        location
      });
      const liveMatches =
        examCentersMatch(live.examCenter, examCenter) &&
        (!location || locationsMatch(live.locationName, location));
      if (liveMatches && isBookableScheduleId(live.examScheduleId)) {
        examScheduleId = live.examScheduleId;
      }
    } catch (error) {
      logger.warn("Live schedule lookup failed; using monitor schedule id if bookable", {
        scheduleId: schedule.scheduleId,
        message: error.message
      });
    }
  }

  if (!isBookableScheduleId(examScheduleId)) {
    throw new Error("Could not resolve a bookable Irembo scheduleID for this detected slot.");
  }

  return {
    examScheduleId,
    examCenter,
    examDate,
    examTime,
    locationName: location,
    assignedScheduleId: schedule.scheduleId
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
  if (
    !schedule ||
    !isOpenUpcomingSchedule(schedule) ||
    !isSystemExamCenter(schedule.center)
  ) {
    return [];
  }

  const waitingApplicants = await listWaitingApplicants();
  const matches = waitingApplicants
    .filter((applicant) => scheduleMatchesApplicant(applicant, schedule))
    .sort((a, b) => applicantPreferredTimeDistance(a, schedule) - applicantPreferredTimeDistance(b, schedule));
  if (matches.length === 0) {
    return [];
  }

  const assignments = [];
  const capacity = Number(schedule.remainingCapacity || 1);

  for (const applicant of matches.slice(0, capacity)) {
    if (await isApplicantHeldForBatch(applicant.id)) {
      continue;
    }
    let assignment;
    try {
      assignment = await resolveBookableAssignment(schedule, {
        preferredExamTime: applicant.preferredExamTime
      });
    } catch (error) {
      logger.warn("Skipping schedule match because bookable id could not be resolved", {
        applicantId: applicant.id,
        scheduleId: schedule.scheduleId,
        message: error.message
      });
      continue;
    }
    try {
      await assignScheduleToApplicant(applicant.id, assignment);
      await enqueueApplicantAutomation(applicant.id, { force: true });
      assignments.push({ applicantId: applicant.id, scheduleId: schedule.scheduleId });
      logger.info("Matched applicant to detected schedule", {
        applicantId: applicant.id,
        scheduleId: schedule.scheduleId,
        examScheduleId: assignment.examScheduleId,
        category: schedule.category,
        location: schedule.location,
        examTime: assignment.examTime
      });
    } catch (error) {
      logger.error("Failed to match applicant to schedule", {
        applicantId: applicant.id,
        scheduleId: schedule.scheduleId,
        message: error.message
      });
    }
  }

  return assignments;
}

export async function processPendingAutomations() {
  await ensureDatabaseSchema();
  const pending = await prisma.applicant.findMany({
    where: { status: "PENDING" },
    orderBy: { updatedAt: "asc" }
  });

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
    await enqueueApplicantAutomation(applicant.id);
  }

  return pending.length;
}

export async function processAllWaitingApplicants() {
  await ensureDatabaseSchema();
  const waiting = await listWaitingApplicants();
  if (waiting.length === 0) {
    return [];
  }

  const assignments = [];
  for (const applicant of waiting) {
    if (await isApplicantHeldForBatch(applicant.id)) {
      continue;
    }
    const matched = await tryMatchApplicantImmediately(applicant.id);
    if (matched.length > 0) {
      assignments.push(...matched);
    }
  }

  if (assignments.length > 0) {
    logger.info("Matched waiting applicants to open schedules", { count: assignments.length });
  }

  return assignments;
}

export async function tryMatchApplicantImmediately(applicantId) {
  await ensureDatabaseSchema();
  if (await isApplicantHeldForBatch(applicantId)) {
    return [];
  }
  const applicant = await prisma.applicant.findUnique({ where: { id: Number(applicantId) } });
  if (!applicant || applicant.status !== "WAITING_FOR_SLOT") {
    return [];
  }

  const wantedCategory = String(applicant.requestedLicenseCategory || applicant.licenseCategory || "")
    .trim()
    .toUpperCase();
  const schedules = await prisma.schedule.findMany({
    where: {
      remainingCapacity: { gt: 0 },
      category: wantedCategory,
      startDateTime: { gt: new Date() },
      ...systemExamCenterDbWhere()
    },
    orderBy: [{ startDateTime: "asc" }]
  });

  const failedScheduleIds = await getFailedScheduleIds(applicantId);

  const matchingSchedules = schedules.filter((schedule) => {
    if (isScheduleBlocked(schedule.scheduleId, failedScheduleIds)) {
      return false;
    }
    return scheduleMatchesApplicant(applicant, schedule);
  });
  const sortedSchedules = sortSchedulesByPreferredTime(matchingSchedules, applicant.preferredExamTime);

  for (const schedule of sortedSchedules) {
    const assigned = await matchApplicantsToSchedule(schedule);
    if (assigned.length > 0) {
      return assigned;
    }
  }

  return [];
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
