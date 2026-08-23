-- CreateTable
CREATE TABLE "MonitorSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "autoNotifyAll" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "MonitorSettings" ("id", "autoNotifyAll", "updatedAt")
VALUES (1, true, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- CreateTable
CREATE TABLE "DetectionAlertRule" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "categories" TEXT NOT NULL,
    "startHour" INTEGER NOT NULL,
    "endHour" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "channels" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionAlertRule_pkey" PRIMARY KEY ("id")
);
