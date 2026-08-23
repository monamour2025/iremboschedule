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
  const guid = scheduleId.includes(":") ? scheduleId.split(":").find((part) => part.includes("-")) : scheduleId;
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
