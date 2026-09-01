import { prisma } from "../lib/db.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { logger } from "../lib/logger.js";
import { enqueueApplicantAutomation } from "../lib/automationQueue.js";
import { createApplicantForBulk, listApplicants } from "./applicantService.js";
import { ensureBatchProfilesReady } from "./entityIdService.js";
import { isProfileRateLimitError } from "../lib/applicantAutomationLock.js";

function isTrulyTerminalApplicant(applicant) {
  if (!TERMINAL_STATUSES.has(applicant.status)) {
    return false;
  }
  if (!applicant.entityId && isProfileRateLimitError(applicant.lastError)) {
    return false;
  }
  return true;
}

const TERMINAL_STATUSES = new Set([
  "APPLICATION_CREATED",
  "COMPLETED",
  "FAILED",
  "FAILED_LOOKUP",
  "FAILED_VALIDATION",
  "FAILED_BOOKING",
  "FAILED_APPLICATION"
]);

const RETRYABLE_STATUSES = new Set([
  "WAITING_FOR_SLOT",
  "PENDING",
  "SAVED",
  "FAILED_LOOKUP",
  "FAILED_BOOKING",
  "FAILED_APPLICATION"
]);

function serializeBatch(batch, applicants = []) {
  const successCount = applicants.filter((row) => row.status === "APPLICATION_CREATED").length;
  const pendingCount = applicants.filter(
    (row) => !TERMINAL_STATUSES.has(row.status)
  ).length;
  return {
    id: batch.id,
    name: batch.name,
    scheduledAt: batch.scheduledAt.toISOString(),
    status: batch.status,
    startedAt: batch.startedAt?.toISOString() || null,
    completedAt: batch.completedAt?.toISOString() || null,
    applicantCount: applicants.length,
    pendingCount,
    successCount,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString()
  };
}

async function buildBatchDetail(batch) {
  const allApplicants = await listApplicants();
  const applicants = allApplicants.filter((row) => row.batchId === batch.id);
  return {
    ...serializeBatch(batch, applicants),
    applicants
  };
}

async function normalizeLegacyDraftApplicants() {
  await prisma.applicant.updateMany({
    where: {
      status: "PENDING",
      batch: { status: "DRAFT" }
    },
    data: {
      status: "SAVED",
      matchedExamScheduleId: null,
      lastError: null
    }
  });
}

export async function saveDraftBatch({ name, applicants = [], batchId = null, autoStart = false }) {
  await ensureDatabaseSchema();
  await normalizeLegacyDraftApplicants();
  if (!Array.isArray(applicants) || applicants.length === 0) {
    const error = new Error("Add at least one applicant before saving.");
    error.statusCode = 400;
    throw error;
  }

  let batch;
  if (batchId) {
    batch = await prisma.automationBatch.findUnique({ where: { id: Number(batchId) } });
    if (!batch) {
      const error = new Error("Applicant list not found.");
      error.statusCode = 404;
      throw error;
    }
    if (batch.status !== "DRAFT") {
      const error = new Error("Only draft lists can be edited. Create a new list instead.");
      error.statusCode = 400;
      throw error;
    }
  } else {
    batch = await prisma.automationBatch.create({
      data: {
        name: name?.trim() || `Applicant list ${new Date().toLocaleString()}`,
        scheduledAt: new Date(),
        status: "DRAFT"
      }
    });
  }

  const created = [];
  for (const row of applicants) {
    const label = row.fullName?.trim() || row.nationalId?.trim() || "Applicant";
    try {
      created.push(await createApplicantForBulk(row, batch.id));
    } catch (error) {
      const wrapped = new Error(`${label}: ${error.message}`);
      wrapped.statusCode = error.statusCode || 400;
      throw wrapped;
    }
  }

  const refreshed = await prisma.automationBatch.findUnique({ where: { id: batch.id } });
  const detail = await buildBatchDetail(refreshed || batch);

  if (autoStart) {
    const started = await automateBatch(batch.id);
    return {
      batch: started,
      applicants: started.applicants || created,
      autoStarted: true
    };
  }

  return {
    batch: detail,
    applicants: created,
    autoStarted: false
  };
}

export async function createAutomationBatch({ name, scheduledAt, applicants = [] }) {
  return saveDraftBatch({ name, applicants });
}

export async function listAutomationBatches() {
  await ensureDatabaseSchema();
  const batches = await prisma.automationBatch.findMany({
    orderBy: { createdAt: "desc" }
  });
  const allApplicants = await listApplicants();
  return batches.map((batch) => serializeBatch(batch, allApplicants.filter((row) => row.batchId === batch.id)));
}

export async function listAutomationBatchesDetailed() {
  await ensureDatabaseSchema();
  await normalizeLegacyDraftApplicants();
  const batches = await prisma.automationBatch.findMany({
    orderBy: { createdAt: "desc" }
  });
  return Promise.all(batches.map((batch) => buildBatchDetail(batch)));
}

export async function resolveBatchProfiles(batchId) {
  await ensureDatabaseSchema();
  return ensureBatchProfilesReady(batchId);
}

export async function automateBatch(batchId) {
  await ensureDatabaseSchema();
  const batch = await prisma.automationBatch.findUnique({ where: { id: Number(batchId) } });
  if (!batch) {
    const error = new Error("Applicant list not found.");
    error.statusCode = 404;
    throw error;
  }
  if (batch.status === "COMPLETED") {
    const error = new Error("This list has already finished.");
    error.statusCode = 400;
    throw error;
  }
  if (batch.status === "RUNNING") {
    return buildBatchDetail(batch);
  }

  const applicants = await prisma.applicant.findMany({ where: { batchId: batch.id } });
  if (applicants.length === 0) {
    const error = new Error("Add applicants to the list before automating.");
    error.statusCode = 400;
    throw error;
  }

  if (batch.status === "DRAFT") {
    await prisma.automationBatch.update({
      where: { id: batch.id },
      data: { scheduledAt: new Date() }
    });
  }

  await ensureBatchProfilesReady(batch.id);

  await startAutomationBatch(batch.id);
  const refreshed = await prisma.automationBatch.findUnique({ where: { id: batch.id } });
  return buildBatchDetail(refreshed || batch);
}

export async function startAutomationBatch(batchId) {
  await ensureDatabaseSchema();
  const { processPendingAutomations } = await import("./applicantMatchingService.js");

  const batch = await prisma.automationBatch.update({
    where: { id: Number(batchId) },
    data: {
      status: "RUNNING",
      startedAt: new Date()
    }
  });

  const applicants = await prisma.applicant.findMany({
    where: { batchId: batch.id },
    orderBy: { createdAt: "asc" }
  });

  logger.info("Starting automation batch", { batchId: batch.id, applicants: applicants.length });

  for (const applicant of applicants) {
    const refreshed = await prisma.applicant.findUnique({ where: { id: applicant.id } });
    try {
      if (refreshed?.status === "SAVED" && refreshed.assignedScheduleId) {
        if (!refreshed.entityId) {
          continue;
        }
        const { assignScheduleFromMonitor } = await import("./applicantMatchingService.js");
        await assignScheduleFromMonitor(applicant.id, refreshed.assignedScheduleId);
        await enqueueApplicantAutomation(applicant.id, { force: true });
        continue;
      }
      if (refreshed?.status === "PENDING") {
        await enqueueApplicantAutomation(applicant.id, { force: true });
        continue;
      }
      if (refreshed?.status === "WAITING_FOR_SLOT") {
        const { tryMatchApplicantImmediately } = await import("./applicantMatchingService.js");
        await tryMatchApplicantImmediately(applicant.id);
        const matched = await prisma.applicant.findUnique({ where: { id: applicant.id } });
        if (matched?.status === "PENDING") {
          await enqueueApplicantAutomation(applicant.id, { force: true });
        }
      }
    } catch (error) {
      logger.error("Batch applicant automation setup failed", {
        batchId: batch.id,
        applicantId: applicant.id,
        message: error.message
      });
      await prisma.applicant.update({
        where: { id: applicant.id },
        data: { lastError: error.message }
      });
    }
  }

  await processPendingAutomations();
  await refreshRunningBatchStatuses();
  return batch;
}

export async function refreshRunningBatchStatuses() {
  await ensureDatabaseSchema();
  const running = await prisma.automationBatch.findMany({
    where: { status: "RUNNING" },
    include: { applicants: true }
  });

  for (const batch of running) {
    if (batch.applicants.length === 0) {
      continue;
    }
    const allTerminal = batch.applicants.every((applicant) => isTrulyTerminalApplicant(applicant));
    if (allTerminal) {
      await prisma.automationBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date()
        }
      });
    }
  }
}

export async function processDueAutomationBatches() {
  await ensureDatabaseSchema();
  const due = await prisma.automationBatch.findMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: { lte: new Date() }
    },
    orderBy: { scheduledAt: "asc" }
  });

  for (const batch of due) {
    await startAutomationBatch(batch.id);
  }

  return due.length;
}

export async function cancelAutomationBatch(batchId) {
  await ensureDatabaseSchema();
  const batch = await prisma.automationBatch.findUnique({ where: { id: Number(batchId) } });
  if (!batch) {
    const error = new Error("Applicant list not found.");
    error.statusCode = 404;
    throw error;
  }
  if (batch.status !== "RUNNING" && batch.status !== "SCHEDULED") {
    const error = new Error("Nothing is running for this list.");
    error.statusCode = 400;
    throw error;
  }

  const applicants = await prisma.applicant.findMany({ where: { batchId: batch.id } });
  const { dequeueApplicantsForBatch } = await import("../lib/automationQueue.js");

  await dequeueApplicantsForBatch(applicants.map((row) => row.id));

  for (const applicant of applicants) {
    if (TERMINAL_STATUSES.has(applicant.status)) {
      continue;
    }

    const nextStatus = applicant.assignedScheduleId ? "SAVED" : "WAITING_FOR_SLOT";
    await prisma.applicant.update({
      where: { id: applicant.id },
      data: {
        status: nextStatus,
        lastError: null
      }
    });
  }

  await prisma.automationBatch.update({
    where: { id: batch.id },
    data: {
      status: "DRAFT",
      completedAt: new Date()
    }
  });

  logger.info("Cancelled automation batch", { batchId: batch.id, applicants: applicants.length });
  return buildBatchDetail(await prisma.automationBatch.findUnique({ where: { id: batch.id } }));
}

export async function processActiveBatchApplicants() {
  await ensureDatabaseSchema();
  const { tryMatchApplicantImmediately, processPendingAutomations } = await import(
    "./applicantMatchingService.js"
  );

  const runningBatches = await prisma.automationBatch.findMany({
    where: { status: "RUNNING" },
    include: {
      applicants: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (runningBatches.length === 0) {
    return 0;
  }

  let touched = 0;
  for (const batch of runningBatches) {
    for (const applicant of batch.applicants) {
      if (TERMINAL_STATUSES.has(applicant.status)) {
        continue;
      }

      if (applicant.status === "WAITING_FOR_SLOT") {
        await tryMatchApplicantImmediately(applicant.id);
      }

      const refreshed = await prisma.applicant.findUnique({ where: { id: applicant.id } });
      if (!refreshed || TERMINAL_STATUSES.has(refreshed.status)) {
        continue;
      }

      if (RETRYABLE_STATUSES.has(refreshed.status)) {
        await enqueueApplicantAutomation(applicant.id, { force: true });
        touched += 1;
      }
    }
  }

  await processPendingAutomations();
  await refreshRunningBatchStatuses();
  return touched;
}
