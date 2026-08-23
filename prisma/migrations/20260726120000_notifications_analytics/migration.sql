-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN "firstDetectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Notification" (
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

-- Backfill firstDetectedAt from createdAt for existing rows
UPDATE "Schedule" SET "firstDetectedAt" = "createdAt" WHERE "firstDetectedAt" IS NULL;
