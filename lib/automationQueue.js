import { logger } from "../lib/logger.js";
import { isTestMode, getAutomationConcurrency } from "../lib/automationConfig.js";
import { canStartApplicantAutomation, isApplicantAutomationRunning, markForceAutomationRun, shouldDeferAutomation } from "../lib/applicantAutomationLock.js";
import { isApplicantHeldForBatch } from "../lib/bulkAutomationHold.js";
import { startWaitingApplicantPoller, stopWaitingApplicantPoller } from "../lib/waitingApplicantPoller.js";
import { runApplicantAutomation } from "../services/automationEngine.js";

const queue = [];
const queuedIds = new Set();
let processing = false;
let workersStarted = false;
let redisQueue = null;

function ensureWorkersStarted() {
  if (workersStarted) {
    return;
  }
  workersStarted = true;
  startWaitingApplicantPoller();
}

async function getRedisQueue() {
  if (redisQueue !== undefined) {
    return redisQueue;
  }

  if (!process.env.REDIS_URL) {
    redisQueue = null;
    return null;
  }

  try {
    const { Queue, Worker } = await import("bullmq");
    const connection = { url: process.env.REDIS_URL };
    const queueName = process.env.AUTOMATION_QUEUE_NAME || "irembo-ddl-automation";

    redisQueue = {
      queue: new Queue(queueName, { connection }),
      worker: new Worker(
        queueName,
        async (job) => runApplicantAutomation(job.data.applicantId),
        { connection, concurrency: getAutomationConcurrency() }
      )
    };

    redisQueue.worker.on("failed", (job, error) => {
      logger.error("Automation queue job failed", {
        applicantId: job?.data?.applicantId,
        message: error.message
      });
    });

    logger.info("BullMQ automation worker started", { queueName, testMode: isTestMode() });
    return redisQueue;
  } catch (error) {
    logger.warn("Redis queue unavailable, using in-process queue", { message: error.message });
    redisQueue = null;
    return null;
  }
}

async function processInMemoryQueue() {
  if (processing) {
    return;
  }

  processing = true;
  const concurrency = getAutomationConcurrency();

  while (queue.length > 0) {
    const batch = queue.splice(0, concurrency);
    for (const job of batch) {
      queuedIds.delete(job.applicantId);
    }

    await Promise.allSettled(
      batch.map(async (job) => {
        try {
          await runApplicantAutomation(job.applicantId);
        } catch (error) {
          logger.error("In-process automation job failed", {
            applicantId: job.applicantId,
            message: error.message
          });
        }
      })
    );
  }

  processing = false;

  if (queue.length > 0) {
    void processInMemoryQueue();
  }
}

export async function enqueueApplicantAutomation(applicantId, options = {}) {
  ensureWorkersStarted();
  const id = Number(applicantId);
  const force = Boolean(options.force);

  const { getApplicantById } = await import("../services/applicantService.js");
  const applicant = await getApplicantById(id, false);
  if (await isApplicantHeldForBatch(id)) {
    return { queued: false, transport: "memory", applicantId: id, reason: "BATCH_SCHEDULED" };
  }
  if (shouldDeferAutomation(applicant, { force })) {
    return { queued: false, transport: "memory", applicantId: id, reason: "DEFERRED" };
  }

  if (!force && (isApplicantAutomationRunning(id) || !canStartApplicantAutomation(id))) {
    return { queued: false, transport: "memory", applicantId: id, reason: "COOLDOWN_OR_RUNNING" };
  }

  if (force) {
    markForceAutomationRun(id);
  }

  const redis = await getRedisQueue();
  if (redis?.queue) {
    await redis.queue.add(
      "process-applicant",
      { applicantId: id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 100
      }
    );
    return { queued: true, transport: "redis", applicantId: id };
  }

  if (queuedIds.has(id)) {
    return { queued: true, transport: "memory", applicantId: id, duplicate: true };
  }

  queuedIds.add(id);
  queue.push({ applicantId: id });
  void processInMemoryQueue();

  return { queued: true, transport: "memory", applicantId: id };
}

export async function dequeueApplicantAutomation(applicantId) {
  const id = Number(applicantId);
  queuedIds.delete(id);
  const index = queue.findIndex((job) => job.applicantId === id);
  if (index >= 0) {
    queue.splice(index, 1);
  }
}

export async function dequeueApplicantsForBatch(applicantIds = []) {
  for (const applicantId of applicantIds) {
    dequeueApplicantAutomation(applicantId);
  }
}

export async function startAutomationWorker() {
  ensureWorkersStarted();
  await getRedisQueue();
  logger.info("Automation worker ready", {
    mode: process.env.AUTOMATION_MODE || "test",
    redis: Boolean(process.env.REDIS_URL)
  });
}

export async function stopAutomationWorker() {
  stopWaitingApplicantPoller();
  workersStarted = false;
  if (redisQueue?.worker) {
    await redisQueue.worker.close();
  }
  if (redisQueue?.queue) {
    await redisQueue.queue.close();
  }
  redisQueue = undefined;
}
