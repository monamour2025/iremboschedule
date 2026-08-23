import { logger } from "./logger.js";
import { getCronScanOptions } from "./cronScan.js";
import { processAllWaitingApplicants, processPendingAutomations } from "../services/applicantMatchingService.js";
import {
  processActiveBatchApplicants,
  processDueAutomationBatches
} from "../services/bulkAutomationService.js";
import { processFailedProfileLookups } from "../services/entityIdService.js";
import { runScan } from "../services/monitorService.js";

async function settle(label, promise) {
  try {
    const value = await promise;
    return { ok: true, value };
  } catch (error) {
    logger.error(`${label} failed`, { message: error.message });
    return { ok: false, error: error.message };
  }
}

/** One serverless-safe tick: optional scan + match/batch/automation flush. */
export async function runAutomationTick(options = {}) {
  const includeScan = options.includeScan !== false;
  const result = {
    scanned: false,
    scan: null,
    batches: null,
    profiles: null,
    activeBatches: null,
    waiting: null,
    pending: null,
    flushed: null
  };

  if (includeScan) {
    result.scanned = true;
    const cronBatch = options.cronScan ? getCronScanOptions() : null;
    const scanOptions = options.scanOptions || cronBatch?.scanOptions || {};
    if (cronBatch) {
      result.cronBatch = {
        batchIndex: cronBatch.batchIndex,
        batchCount: cronBatch.batchCount,
        locationCount: cronBatch.locationCount,
        locations: cronBatch.locations
      };
    }
    result.scan = await settle("Cron scan", runScan(scanOptions));
  }

  result.batches = await settle("Bulk automation scheduler", processDueAutomationBatches());
  result.profiles = await settle("Profile auto-retry", processFailedProfileLookups());
  result.activeBatches = await settle("Active batch automation", processActiveBatchApplicants());
  result.waiting = await settle("Waiting applicant match", processAllWaitingApplicants());
  result.pending = await settle("Pending automation enqueue", processPendingAutomations());

  const { flushInMemoryAutomationQueue } = await import("./automationQueue.js");
  result.flushed = await settle("In-memory automation flush", flushInMemoryAutomationQueue());

  return result;
}
