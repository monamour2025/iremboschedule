import { loadEnvFiles } from "../lib/loadEnv.js";
import { runScan } from "../services/monitorService.js";
import { logger } from "../lib/logger.js";

loadEnvFiles();

let timer = null;
let running = false;

export async function runOnce(options = {}) {
  if (running) {
    logger.warn("Scan skipped because a previous scan is still running");
    return { ok: false, skipped: true };
  }

  running = true;
  try {
    return await runScan(options);
  } finally {
    running = false;
  }
}

export function startScheduler(options = {}) {
  const intervalMinutes = Number(options.intervalMinutes || process.env.SCAN_INTERVAL_MINUTES || 5);
  const intervalMs = Math.max(intervalMinutes, 1) * 60 * 1000;

  logger.info("Starting schedule monitor worker", { intervalMinutes });

  runOnce(options).catch((error) => {
    logger.error("Initial scheduled scan failed", { message: error.message });
  });

  timer = setInterval(() => {
    runOnce(options).catch((error) => {
      logger.error("Scheduled scan failed", { message: error.message });
    });
  }, intervalMs);

  return timer;
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

if (process.argv.includes("--once")) {
  runOnce()
    .then((result) => {
      logger.info("One-time scan complete", result);
      process.exit(0);
    })
    .catch((error) => {
      logger.error("One-time scan failed", { message: error.message });
      process.exit(1);
    });
} else if (process.argv[1]?.endsWith("scheduler.js")) {
  startScheduler();
}
