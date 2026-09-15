import { prisma } from "../lib/db.js";
import { compareSchedules } from "../lib/compare.js";
import { bulkUpsertSchedules } from "../lib/bulkUpsert.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { isSystemExamCenter, SYSTEM_EXAM_CENTER, systemExamCenterDbWhere } from "../lib/examCenters.js";
import { isDetectedSchedule, canonicalizeSchedule, scheduleMatchesCategoryFilter, scheduleMatchesLocationFilter, getMonitorPriorityConfig } from "../lib/monitorPriority.js";
import { logger } from "../lib/logger.js";
import {
  fetchSchedules,
  getMonitoredCategories,
  getMonitoredLocations
} from "../providers/iremboProvider.js";
import { prepareNotifications } from "./notificationService.js";
import { processDetectedSchedulesForApplicants, processAllWaitingApplicants } from "./applicantMatchingService.js";
import { scheduleMatchesCategory, isOpenUpcomingSchedule } from "../lib/scheduleTime.js";

const scheduleSelect = {
  scheduleId: true,
  center: true,
  location: true,
  category: true,
  startDateTime: true,
  endDateTime: true,
  remainingCapacity: true,
  maximumCapacity: true
};

function buildScopeFilter(scannedScopes) {
  if (!scannedScopes.length) {
    return undefined;
  }

  return {
    OR: scannedScopes.map((scope) => ({
      category: scope.category,
      location: scope.location
    }))
  };
}

export async function runScan(options = {}) {
  await ensureDatabaseSchema();
  const startedAt = new Date();
  logger.info("Starting schedule scan", options);

  const latestSchedules = await fetchSchedules(options);
  const scanMeta = latestSchedules.scanMeta || {
    scannedLocations: [],
    failedLocations: [],
    scannedScopes: [],
    failedScopes: []
  };

  const previousSchedules = await prisma.schedule.findMany({
    where: buildScopeFilter(scanMeta.scannedScopes),
    select: scheduleSelect
  });

  const changes = compareSchedules(previousSchedules, latestSchedules);
  const latestScheduleIds = latestSchedules.map((schedule) => schedule.scheduleId);

  const snapshot = await prisma.$transaction(async (tx) => {
    const createdSnapshot = await tx.snapshot.create({
      data: { createdAt: startedAt }
    });

    await bulkUpsertSchedules(latestSchedules, startedAt, tx);

    await tx.schedule.deleteMany({
      where: {
        OR: [
          {
            NOT: {
              center: { equals: SYSTEM_EXAM_CENTER, mode: "insensitive" }
            }
          },
          { startDateTime: { lte: startedAt } },
          { startDateTime: null },
          { remainingCapacity: { lte: 0 } }
        ]
      }
    });

    if (scanMeta.scannedScopes.length > 0 && latestScheduleIds.length > 0) {
      await tx.schedule.deleteMany({
        where: {
          OR: scanMeta.scannedScopes.map((scope) => ({
            category: scope.category,
            location: scope.location
          })),
          scheduleId: { notIn: latestScheduleIds }
        }
      });
    } else if (scanMeta.scannedScopes.length > 0 && latestScheduleIds.length === 0) {
      logger.warn("Skipping stale schedule cleanup: scan returned zero schedules", {
        scannedScopeCount: scanMeta.scannedScopes.length
      });
    }

    if (changes.length > 0) {
      await tx.change.createMany({ data: changes });
    }

    return createdSnapshot;
  }, {
    maxWait: 10000,
    timeout: 180000
  });

  prepareNotifications(changes, latestSchedules).catch((error) => {
    logger.error("Notification dispatch failed after scan", { message: error.message });
  });

  processDetectedSchedulesForApplicants(changes, latestSchedules).catch((error) => {
    logger.error("Applicant auto-matching failed after scan", { message: error.message });
  });

  processAllWaitingApplicants().catch((error) => {
    logger.error("Waiting applicant matching failed after scan", { message: error.message });
  });

  logger.info("Finished schedule scan", {
    snapshotId: snapshot.id,
    scheduleCount: latestSchedules.length,
    changeCount: changes.length,
    scannedLocationCount: scanMeta.scannedLocations.length,
    failedLocationCount: scanMeta.failedLocations.length
  });

  return {
    ok: true,
    snapshotId: snapshot.id,
    scannedAt: startedAt.toISOString(),
    scheduleCount: latestSchedules.length,
    changeCount: changes.length,
    scannedLocationCount: scanMeta.scannedLocations.length,
    failedLocationCount: scanMeta.failedLocations.length,
    failedLocations: scanMeta.failedLocations,
    changes
  };
}

export async function purgeExpiredAndClosedSchedules(now = new Date()) {
  await prisma.schedule.deleteMany({
    where: {
      OR: [{ startDateTime: { lte: now } }, { startDateTime: null }, { remainingCapacity: { lte: 0 } }]
    }
  });
}

export async function purgeStaleMonitorSchedules(now = new Date()) {
  await purgeNonSystemExamSchedules();
  await purgeExpiredAndClosedSchedules(now);
}

export async function getStatus() {
  await ensureDatabaseSchema();
  await purgeStaleMonitorSchedules();
  const centerWhere = systemExamCenterDbWhere();
  const availableWhere = {
    remainingCapacity: { gt: 0 },
    startDateTime: { gt: new Date() },
    ...centerWhere
  };
  const [lastSnapshot, scheduleCount, availableScheduleCount, slotAggregate, changeCount, latestChange] =
    await Promise.all([
      prisma.snapshot.findFirst({ orderBy: { createdAt: "desc" } }),
      prisma.schedule.count({ where: centerWhere }),
      prisma.schedule.count({ where: availableWhere }),
      prisma.schedule.aggregate({
        where: availableWhere,
        _sum: { remainingCapacity: true }
      }),
      prisma.change.count(),
      prisma.change.findFirst({ orderBy: { createdAt: "desc" } })
    ]);

  const monitoredLocations = getMonitoredLocations();
  const monitoredCategories = getMonitoredCategories();

  return {
    ok: true,
    status: "READY",
    lastScanAt: lastSnapshot?.createdAt?.toISOString() || null,
    scheduleCount,
    availableScheduleCount,
    remainingSlots: Number(slotAggregate._sum.remainingCapacity || 0),
    changeCount,
    latestChangeAt: latestChange?.createdAt?.toISOString() || null,
    monitor: {
      service: process.env.IREMBO_SERVICE || "PRACTICAL_EXAM",
      categories: monitoredCategories,
      beneficiaries: process.env.IREMBO_BENEFICIARIES || "PrivateCandidate",
      locationMode: "AUTOMATIC",
      locationCount: monitoredLocations.length,
      locations: monitoredLocations,
      priority: getMonitorPriorityConfig()
    }
  };
}

export async function listSchedules(options = {}) {
  await ensureDatabaseSchema();
  await purgeStaleMonitorSchedules();
  const availableOnly = options.availableOnly !== false;
  const limit = Number(options.limit || process.env.SCHEDULES_API_LIMIT || 3000);
  const where = { ...systemExamCenterDbWhere() };

  if (availableOnly) {
    where.remainingCapacity = { gt: 0 };
    where.startDateTime = { gt: new Date() };
  }
  if (options.category) {
    where.category = String(options.category).trim().toUpperCase();
  }
  if (options.center && !isSystemExamCenter(options.center)) {
    return [];
  }
  where.center = { equals: SYSTEM_EXAM_CENTER, mode: "insensitive" };

  return prisma.schedule.findMany({
    where,
    orderBy: [{ remainingCapacity: "desc" }, { startDateTime: "asc" }, { scheduleId: "asc" }],
    take: Number.isFinite(limit) && limit > 0 ? limit : undefined
  }).then((rows) => {
    let normalizedRows = rows
      .map((schedule) => canonicalizeSchedule(schedule))
      .filter((schedule) => isSystemExamCenter(schedule.center) && isOpenUpcomingSchedule(schedule));
    if (options.location) {
      normalizedRows = normalizedRows.filter((schedule) =>
        scheduleMatchesLocationFilter(schedule, options.location)
      );
    }
    if (options.category) {
      normalizedRows = normalizedRows.filter((schedule) =>
        scheduleMatchesCategoryFilter(schedule, options.category)
      );
    }
    if (options.detectedOnly === false) {
      return normalizedRows;
    }
    return normalizedRows.filter((schedule) => isDetectedSchedule(schedule));
  });
}

/** Category slots for pick-slot UI — always merges priority center (Busanza) for every category. */
export async function listCategorySlotsForPicker(category, options = {}) {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  if (!normalizedCategory) {
    return [];
  }

  const priority = getMonitorPriorityConfig();
  const center = String(options.center || "").trim();
  const location = options.location ? String(options.location).trim() : undefined;

  if (center) {
    return listSchedules({
      availableOnly: true,
      category: normalizedCategory,
      center,
      location,
      limit: Number(options.limit || 1000)
    });
  }

  const generalLimit = Number(options.limit || process.env.PICK_SLOT_CATEGORY_LIMIT || 5000);
  const [generalRows, priorityRows] = await Promise.all([
    listSchedules({
      availableOnly: true,
      category: normalizedCategory,
      location,
      limit: generalLimit
    }),
    listSchedules({
      availableOnly: true,
      category: normalizedCategory,
      center: priority.center,
      location: priority.location,
      limit: 1000
    })
  ]);

  const byId = new Map();
  for (const row of [...generalRows, ...priorityRows]) {
    byId.set(row.scheduleId, row);
  }

  return [...byId.values()]
    .filter((row) => scheduleMatchesCategory(row, normalizedCategory))
    .sort(
      (a, b) => new Date(a.startDateTime || 0) - new Date(b.startDateTime || 0)
    );
}

export async function listChanges(limit = 50) {
  await ensureDatabaseSchema();
  const rows = await prisma.change.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(Number(limit) * 8, 200)
  });
  return rows
    .filter((change) => {
      for (const raw of [change.newValue, change.oldValue]) {
        if (!raw) {
          continue;
        }
        try {
          const parsed = JSON.parse(raw);
          if (isSystemExamCenter(parsed?.center)) {
            return true;
          }
        } catch {
          // Ignore malformed change payloads.
        }
      }
      return false;
    })
    .slice(0, Number(limit) || 50);
}
