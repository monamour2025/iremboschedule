import { logger } from "../lib/logger.js";
import { processAllWaitingApplicants, processPendingAutomations } from "../services/applicantMatchingService.js";
import {
  processActiveBatchApplicants,
  processDueAutomationBatches
} from "../services/bulkAutomationService.js";
import { processFailedProfileLookups } from "../services/entityIdService.js";

const intervalSeconds = Number(process.env.APPLICANT_MATCH_INTERVAL_SECONDS || 5);
let timer = null;

export function startWaitingApplicantPoller() {
  if (timer) {
    return timer;
  }

  const intervalMs = Math.max(intervalSeconds, 5) * 1000;
  logger.info("Starting waiting applicant poller", { intervalSeconds });

  const tick = () => {
    processDueAutomationBatches().catch((error) => {
      logger.error("Bulk automation scheduler failed", { message: error.message });
    });
    processFailedProfileLookups().catch((error) => {
      logger.error("Profile auto-retry failed", { message: error.message });
    });
    processActiveBatchApplicants().catch((error) => {
      logger.error("Active batch automation failed", { message: error.message });
    });
    processAllWaitingApplicants().catch((error) => {
      logger.error("Waiting applicant poller failed", { message: error.message });
    });
    processPendingAutomations().catch((error) => {
      logger.error("Pending automation poller failed", { message: error.message });
    });
  };

  tick();
  timer = setInterval(tick, intervalMs);
  return timer;
}

export function stopWaitingApplicantPoller() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
