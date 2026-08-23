import { runScan } from "../services/monitorService.js";
import { logger } from "./logger.js";

let activeScan = null;
let lastScanError = null;

export function isScanRunning() {
  return Boolean(activeScan);
}

export function getScanRunnerState() {
  return {
    running: Boolean(activeScan),
    lastError: lastScanError
  };
}

export function startBackgroundScan(options = {}) {
  if (activeScan) {
    return { ok: true, status: "ALREADY_RUNNING" };
  }

  lastScanError = null;
  activeScan = runScan(options)
    .catch((error) => {
      lastScanError = error.message;
      logger.error("Background scan failed", { message: error.message });
      throw error;
    })
    .finally(() => {
      activeScan = null;
    });

  return { ok: true, status: "STARTED" };
}

export async function waitForScanCompletion({ timeoutMs = 10 * 60 * 1000, pollMs = 2000 } = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!activeScan) {
      if (lastScanError) {
        throw new Error(lastScanError);
      }
      return { ok: true, status: "COMPLETED" };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Scan is still running. Check back shortly.");
}
