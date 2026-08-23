import { loadEnvFiles } from "../lib/loadEnv.js";
import { spawn } from "node:child_process";
import { warmIremboSession } from "../lib/iremboSession.js";
import { ensureIremboCitizenAuth, hasIremboCitizenCredentials } from "../lib/iremboCitizenAuth.js";
import { logger } from "../lib/logger.js";
import { startScheduler, stopScheduler } from "../worker/scheduler.js";
import { startAutomationWorker, stopAutomationWorker } from "../lib/automationQueue.js";

loadEnvFiles();

const nextProcess = spawn("node_modules\\.bin\\next.cmd", ["dev"], {
  cwd: process.cwd(),
  shell: true,
  stdio: "inherit"
});

startScheduler();
startAutomationWorker().catch(() => {});
warmIremboSession(true).catch(() => {});
if (hasIremboCitizenCredentials()) {
  ensureIremboCitizenAuth(true).catch((error) => {
    logger.warn("Irembo auto-login skipped", { message: error.message });
  });
}

function shutdown(signal) {
  stopScheduler();
  stopAutomationWorker().catch(() => {});

  if (!nextProcess.killed) {
    nextProcess.kill(signal);
  }
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
  process.exit(0);
});

nextProcess.on("exit", (code) => {
  stopScheduler();
  process.exit(code || 0);
});
