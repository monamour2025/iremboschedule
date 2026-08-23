import { prisma } from "./db.js";
import { logger } from "./logger.js";

let schemaReady = null;

export async function ensureDatabaseSchema() {
  if (schemaReady) {
    return schemaReady;
  }

  schemaReady = (async () => {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Schedule"
      ADD COLUMN IF NOT EXISTS "firstDetectedAt" TIMESTAMP(3);
    `);

    await prisma.$executeRawUnsafe(`
      UPDATE "Schedule"
      SET "firstDetectedAt" = "createdAt"
      WHERE "firstDetectedAt" IS NULL;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Notification" (
        "id" SERIAL NOT NULL,
        "scheduleId" TEXT,
        "channel" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "message" TEXT NOT NULL,
        "payload" TEXT,
        "status" TEXT NOT NULL,
        "error" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MonitorSettings" (
        "id" INTEGER NOT NULL DEFAULT 1,
        "autoNotifyAll" BOOLEAN NOT NULL DEFAULT true,
        "alertEmail" TEXT NOT NULL DEFAULT '',
        "alertPhone" TEXT NOT NULL DEFAULT '',
        "alertWebhookUrl" TEXT NOT NULL DEFAULT '',
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "MonitorSettings_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MonitorSettings"
      ADD COLUMN IF NOT EXISTS "alertEmail" TEXT NOT NULL DEFAULT '';
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MonitorSettings"
      ADD COLUMN IF NOT EXISTS "alertPhone" TEXT NOT NULL DEFAULT '';
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "MonitorSettings"
      ADD COLUMN IF NOT EXISTS "alertWebhookUrl" TEXT NOT NULL DEFAULT '';
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "MonitorSettings" ("id", "autoNotifyAll", "alertEmail", "alertPhone", "alertWebhookUrl", "updatedAt")
      VALUES (1, true, '', '', '', CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "DetectionAlertRule" (
        "id" SERIAL NOT NULL,
        "name" TEXT NOT NULL,
        "categories" TEXT NOT NULL,
        "startHour" INTEGER NOT NULL,
        "endHour" INTEGER NOT NULL,
        "message" TEXT NOT NULL,
        "channels" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DetectionAlertRule_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Applicant" (
        "id" SERIAL NOT NULL,
        "fullName" TEXT NOT NULL,
        "nationalIdEnc" TEXT NOT NULL,
        "nationalIdHash" TEXT NOT NULL,
        "dateOfBirth" TIMESTAMP(3) NOT NULL,
        "phone" TEXT NOT NULL,
        "email" TEXT NOT NULL,
        "licenseCategory" TEXT NOT NULL,
        "examType" TEXT NOT NULL DEFAULT 'PRACTICAL',
        "examCenter" TEXT NOT NULL,
        "examDate" TIMESTAMP(3) NOT NULL,
        "examTime" TEXT NOT NULL,
        "entityId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "lastError" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "Applicant_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Applicant_nationalIdHash_key" ON "Applicant"("nationalIdHash");
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Application" (
        "id" SERIAL NOT NULL,
        "applicantId" INTEGER NOT NULL,
        "iremboEntityId" TEXT,
        "temporaryBookingId" TEXT,
        "examScheduleId" TEXT,
        "applicationNumber" TEXT,
        "amount" INTEGER,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "responseData" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AutomationLog" (
        "id" SERIAL NOT NULL,
        "applicantId" INTEGER NOT NULL,
        "action" TEXT NOT NULL,
        "requestPayload" TEXT,
        "responsePayload" TEXT,
        "success" BOOLEAN NOT NULL DEFAULT false,
        "errorMessage" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AutomationLog_pkey" PRIMARY KEY ("id")
      );
    `);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "preferredLocation" TEXT NOT NULL DEFAULT '';
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "assignedScheduleId" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ALTER COLUMN "dateOfBirth" DROP NOT NULL;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ALTER COLUMN "email" SET DEFAULT '';
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ALTER COLUMN "examCenter" DROP NOT NULL;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ALTER COLUMN "examDate" DROP NOT NULL;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ALTER COLUMN "examTime" DROP NOT NULL;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "matchedExamScheduleId" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "lastFailedScheduleId" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "provisionalLicenseNumber" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "provisionalLicenseExpiry" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "applicationType" TEXT NOT NULL DEFAULT 'FIRST_LICENCE';
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseId" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseNumber" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseCategory" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseCategories" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseExpiry" TIMESTAMP(3);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseIssueDate" TIMESTAMP(3);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseStatus" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseDocumentType" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseApplicationNumber" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseVehicleClass" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "existingLicenseFetchedAt" TIMESTAMP(3);
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "requestedLicenseCategory" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "preferredExamTime" TEXT;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AutomationBatch" (
        "id" SERIAL NOT NULL,
        "name" TEXT NOT NULL,
        "scheduledAt" TIMESTAMP(3) NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
        "startedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AutomationBatch_pkey" PRIMARY KEY ("id")
      );
    `);
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "batchId" INTEGER;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CitizenProfileCache" (
        "nationalIdHash" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "displayName" TEXT,
        "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CitizenProfileCache_pkey" PRIMARY KEY ("nationalIdHash")
      );
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE "Applicant"
      SET "preferredLocation" = COALESCE(NULLIF("preferredLocation", ''), 'Kicukiro')
      WHERE "preferredLocation" IS NULL OR "preferredLocation" = '';
    `);
  })().catch((error) => {
    schemaReady = null;
    logger.error("Failed to ensure database schema", { message: error.message });
    throw error;
  });

  return schemaReady;
}

// Backward-compatible alias
export const ensureAlertTables = ensureDatabaseSchema;
