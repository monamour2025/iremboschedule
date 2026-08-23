import { logger } from "../lib/logger.js";
import { runAutomationTick } from "./automationTick.js";

const intervalSeconds = Number(process.env.APPLICANT_MATCH_INTERVAL_SECONDS || 5);
let timer = null;

export function startWaitingApplicantPoller() {
  // On Vercel, long-lived pollers do not survive; cron hits /api/cron/tick instead.
  if (process.env.VERCEL) {
    return null;
  }

  if (timer) {
    return timer;
  }

  const intervalMs = Math.max(intervalSeconds, 5) * 1000;
  logger.info("Starting waiting applicant poller", { intervalSeconds });

  const tick = () => {
    runAutomationTick({ includeScan: false }).catch((error) => {
      logger.error("Waiting applicant poller failed", { message: error.message });
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
