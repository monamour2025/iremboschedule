import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { normalizeCenterName } from "../lib/examCenters.js";

function parseScheduleFromChange(change) {
  if (!change?.newValue) {
    return null;
  }

  try {
    return JSON.parse(change.newValue);
  } catch {
    return null;
  }
}

function emptyAnalytics() {
  return {
    ok: true,
    summary: {
      totalSchedules: 0,
      availableSchedules: 0,
      totalRemainingSlots: 0,
      detectionsLast7Days: 0,
      changesLast7Days: 0,
      notificationsSent: 0
    },
    activeLocations: [],
    activeCenters: [],
    categoryBreakdown: [],
    recentDetections: [],
    availabilityTrend: [],
    scanHistory: []
  };
}

async function safeNotificationCount() {
  try {
    await ensureDatabaseSchema();
    return await prisma.notification.count({ where: { status: "SENT" } });
  } catch (error) {
    logger.warn("Notification count unavailable for analytics", { message: error.message });
    return 0;
  }
}

export async function getAnalyticsSummary() {
  await ensureDatabaseSchema();
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const availableWhere = { remainingCapacity: { gt: 0 } };

    const [
      totalSchedules,
      availableScheduleCount,
      slotAggregate,
      activeLocations,
      activeCenters,
      categoryCenterBreakdown,
      recentChanges,
      notificationsSent,
      snapshots
    ] = await Promise.all([
      prisma.schedule.count(),
      prisma.schedule.count({ where: availableWhere }),
      prisma.schedule.aggregate({ where: availableWhere, _sum: { remainingCapacity: true } }),
      prisma.schedule.groupBy({
        by: ["location"],
        where: availableWhere,
        _count: { _all: true }
      }),
      prisma.schedule.groupBy({
        by: ["center"],
        where: availableWhere,
        _count: { _all: true }
      }),
      prisma.schedule.groupBy({
        by: ["category", "center", "location"],
        where: availableWhere,
        _count: { _all: true }
      }),
      prisma.change.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 500
      }),
      safeNotificationCount(),
      prisma.snapshot.findMany({
        orderBy: { createdAt: "desc" },
        take: 14
      })
    ]);

    const detections = recentChanges
      .filter((change) => change.type === "NEW_SCHEDULE")
      .slice(0, 20)
      .map((change) => ({
        scheduleId: change.scheduleId,
        detectedAt: change.createdAt,
        schedule: parseScheduleFromChange(change)
      }));

    const trendMap = new Map();
    for (const change of recentChanges) {
      const day = change.createdAt.toISOString().slice(0, 10);
      const bucket = trendMap.get(day) || {
        day,
        newSchedules: 0,
        capacityIncreases: 0,
        removals: 0
      };

      if (change.type === "NEW_SCHEDULE") {
        bucket.newSchedules += 1;
      } else if (change.type === "CAPACITY_INCREASE") {
        bucket.capacityIncreases += 1;
      } else if (change.type === "REMOVED_SCHEDULE") {
        bucket.removals += 1;
      }

      trendMap.set(day, bucket);
    }

    const categoryMap = new Map();
    for (const item of categoryCenterBreakdown) {
      const name = item.category || "Unknown";
      const center = normalizeCenterName(item.center || "Unknown");
      const location = item.location || "";
      const count = item._count._all;
      if (!categoryMap.has(name)) {
        categoryMap.set(name, { name, count: 0, sites: [] });
      }
      const entry = categoryMap.get(name);
      entry.count += count;
      const existingSite = entry.sites.find(
        (site) =>
          site.center.toLowerCase() === center.toLowerCase() &&
          site.location.toLowerCase() === location.toLowerCase()
      );
      if (existingSite) {
        existingSite.count += count;
      } else {
        entry.sites.push({ center, location, count });
      }
    }

    const categoryBreakdown = [...categoryMap.values()]
      .map((entry) => ({
        ...entry,
        sites: entry.sites.sort((left, right) => right.count - left.count)
      }))
      .sort((left, right) => right.count - left.count);

    return {
      ok: true,
      summary: {
        totalSchedules,
        availableSchedules: availableScheduleCount,
        totalRemainingSlots: Number(slotAggregate._sum.remainingCapacity || 0),
        detectionsLast7Days: recentChanges.filter((change) => change.type === "NEW_SCHEDULE").length,
        changesLast7Days: recentChanges.length,
        notificationsSent
      },
      activeLocations: activeLocations
        .map((item) => ({
          name: item.location || "Unknown",
          count: item._count._all
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 10),
      activeCenters: activeCenters
        .map((item) => ({
          name: item.center || "Unknown",
          count: item._count._all
        }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 10),
      categoryBreakdown,
      recentDetections: detections,
      availabilityTrend: [...trendMap.values()].sort((left, right) => left.day.localeCompare(right.day)),
      scanHistory: snapshots.map((snapshot) => ({
        id: snapshot.id,
        scannedAt: snapshot.createdAt
      }))
    };
  } catch (error) {
    logger.error("Analytics summary failed", { message: error.message });
    return emptyAnalytics();
  }
}
