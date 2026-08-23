-- CreateTable
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

ALTER TABLE "Applicant" ADD COLUMN IF NOT EXISTS "batchId" INTEGER;
