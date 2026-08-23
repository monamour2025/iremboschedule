import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { canonicalizeSchedule } from "./monitorPriority.js";

const CHUNK_SIZE = 500;

function toRow(schedule, scannedAt) {
  const normalized = canonicalizeSchedule(schedule);
  return {
    scheduleId: normalized.scheduleId,
    center: normalized.center ?? null,
    location: normalized.location ?? null,
    category: normalized.category ?? null,
    startDateTime: normalized.startDateTime ? new Date(normalized.startDateTime) : null,
    endDateTime: normalized.endDateTime ? new Date(normalized.endDateTime) : null,
    remainingCapacity:
      normalized.remainingCapacity === null || normalized.remainingCapacity === undefined
        ? null
        : Number(normalized.remainingCapacity),
    maximumCapacity:
      normalized.maximumCapacity === null || normalized.maximumCapacity === undefined
        ? null
        : Number(normalized.maximumCapacity),
    firstDetectedAt: scannedAt,
    lastSeen: scannedAt
  };
}

export async function bulkUpsertSchedules(schedules, scannedAt, client = prisma) {
  if (schedules.length === 0) {
    return;
  }

  for (let index = 0; index < schedules.length; index += CHUNK_SIZE) {
    const chunk = schedules.slice(index, index + CHUNK_SIZE).map((schedule) => toRow(schedule, scannedAt));
    const values = chunk.map(
      (row) => Prisma.sql`(
        ${row.scheduleId},
        ${row.center},
        ${row.location},
        ${row.category},
        ${row.startDateTime},
        ${row.endDateTime},
        ${row.remainingCapacity},
        ${row.maximumCapacity},
        ${row.firstDetectedAt},
        ${row.lastSeen},
        ${scannedAt}
      )`
    );

    await client.$executeRaw`
      INSERT INTO "Schedule" (
        "scheduleId",
        "center",
        "location",
        "category",
        "startDateTime",
        "endDateTime",
        "remainingCapacity",
        "maximumCapacity",
        "firstDetectedAt",
        "lastSeen",
        "updatedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("scheduleId") DO UPDATE SET
        "center" = EXCLUDED."center",
        "location" = EXCLUDED."location",
        "category" = EXCLUDED."category",
        "startDateTime" = EXCLUDED."startDateTime",
        "endDateTime" = EXCLUDED."endDateTime",
        "remainingCapacity" = EXCLUDED."remainingCapacity",
        "maximumCapacity" = EXCLUDED."maximumCapacity",
        "lastSeen" = EXCLUDED."lastSeen",
        "updatedAt" = EXCLUDED."updatedAt"
    `;
  }
}
