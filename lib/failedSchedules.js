import { prisma } from "../lib/db.js";

export async function getFailedScheduleIds(applicantId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "lastFailedScheduleId"
    FROM "Applicant"
    WHERE "id" = ${Number(applicantId)}
  `);
  const value = rows?.[0]?.lastFailedScheduleId;
  if (!value) {
    return new Set();
  }
  return new Set(String(value).split(",").map((part) => part.trim()).filter(Boolean));
}

export function isScheduleBlocked(scheduleId, failedIds) {
  if (!scheduleId || failedIds.size === 0) {
    return false;
  }
  if (failedIds.has(scheduleId)) {
    return true;
  }
  const value = String(scheduleId);
  // Live sittings are CAT:uuid@HH:MM. Do not treat an older UUID-only failure as
  // a block for a different time on the same Irembo schedule.
  if (value.includes("@")) {
    return false;
  }
  const guid = value.includes(":") ? value.split(":").find((part) => part.includes("-")) : value;
  return guid ? failedIds.has(guid) : false;
}

export async function appendFailedScheduleId(applicantId, scheduleId) {
  if (!scheduleId) {
    return;
  }
  const safeId = String(scheduleId).replaceAll("'", "''");
  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET "lastFailedScheduleId" = CASE
      WHEN "lastFailedScheduleId" IS NULL OR "lastFailedScheduleId" = '' THEN '${safeId}'
      WHEN "lastFailedScheduleId" LIKE '%${safeId}%' THEN "lastFailedScheduleId"
      ELSE "lastFailedScheduleId" || ',' || '${safeId}'
    END,
    "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${Number(applicantId)}
  `);
}
