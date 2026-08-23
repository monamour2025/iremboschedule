import { prisma } from "./db.js";
import { ensureDatabaseSchema } from "./ensureSchema.js";

export { ensureDatabaseSchema, ensureDatabaseSchema as ensureAlertTables } from "./ensureSchema.js";

export async function readMonitorSettingsRow() {
  await ensureDatabaseSchema();
  const rows = await prisma.$queryRaw`
    SELECT "id", "autoNotifyAll", "alertEmail", "alertPhone", "alertWebhookUrl", "updatedAt"
    FROM "MonitorSettings"
    WHERE "id" = 1
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function writeMonitorSettingsRow(data) {
  await ensureDatabaseSchema();
  const rows = await prisma.$queryRaw`
    UPDATE "MonitorSettings"
    SET
      "autoNotifyAll" = ${data.autoNotifyAll},
      "alertEmail" = ${data.alertEmail},
      "alertPhone" = ${data.alertPhone},
      "alertWebhookUrl" = ${data.alertWebhookUrl},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = 1
    RETURNING "id", "autoNotifyAll", "alertEmail", "alertPhone", "alertWebhookUrl", "updatedAt"
  `;
  return rows[0];
}

export async function listDetectionRuleRows() {
  await ensureDatabaseSchema();
  return prisma.$queryRaw`
    SELECT *
    FROM "DetectionAlertRule"
    ORDER BY "enabled" DESC, "startHour" ASC, "id" ASC
  `;
}

export async function listEnabledDetectionRuleRows() {
  await ensureDatabaseSchema();
  return prisma.$queryRaw`
    SELECT *
    FROM "DetectionAlertRule"
    WHERE "enabled" = true
    ORDER BY "id" ASC
  `;
}

export async function insertDetectionRuleRow(data) {
  await ensureDatabaseSchema();
  const rows = await prisma.$queryRaw`
    INSERT INTO "DetectionAlertRule" (
      "name", "categories", "startHour", "endHour", "message", "channels", "enabled", "updatedAt"
    )
    VALUES (
      ${data.name},
      ${data.categories},
      ${data.startHour},
      ${data.endHour},
      ${data.message},
      ${data.channels},
      ${data.enabled},
      CURRENT_TIMESTAMP
    )
    RETURNING *
  `;
  return rows[0];
}

export async function updateDetectionRuleRow(id, data) {
  await ensureDatabaseSchema();
  const rows = await prisma.$queryRaw`
    UPDATE "DetectionAlertRule"
    SET
      "name" = ${data.name},
      "categories" = ${data.categories},
      "startHour" = ${data.startHour},
      "endHour" = ${data.endHour},
      "message" = ${data.message},
      "channels" = ${data.channels},
      "enabled" = ${data.enabled},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${id}
    RETURNING *
  `;
  return rows[0];
}

export async function patchDetectionRuleRow(id, data) {
  await ensureDatabaseSchema();
  const existing = await prisma.$queryRaw`
    SELECT * FROM "DetectionAlertRule" WHERE "id" = ${id} LIMIT 1
  `;
  if (!existing[0]) {
    throw new Error("Detection window not found");
  }

  const current = existing[0];
  return updateDetectionRuleRow(id, {
    name: data.name ?? current.name,
    categories: data.categories ?? current.categories,
    startHour: data.startHour ?? current.startHour,
    endHour: data.endHour ?? current.endHour,
    message: data.message ?? current.message,
    channels: data.channels ?? current.channels,
    enabled: data.enabled ?? current.enabled
  });
}

export async function deleteDetectionRuleRow(id) {
  await ensureDatabaseSchema();
  await prisma.$executeRaw`
    DELETE FROM "DetectionAlertRule" WHERE "id" = ${id}
  `;
}
