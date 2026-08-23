import { loadEnvFiles } from "../lib/loadEnv.js";
import { startAutomationWorker, stopAutomationWorker } from "../lib/automationQueue.js";
import { logAutomationConfig } from "../lib/automationConfig.js";
import { logger } from "../lib/logger.js";

loadEnvFiles();
logAutomationConfig();

startAutomationWorker().catch((error) => {
  logger.error("Failed to start automation worker", { message: error.message });
});

process.on("SIGINT", async () => {
  await stopAutomationWorker();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await stopAutomationWorker();
  process.exit(0);
});
