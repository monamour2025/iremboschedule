import { logger } from "./logger.js";

const AUTOMATION_MODE = process.env.AUTOMATION_MODE || "production";
const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || "";

export function isTestMode() {
  return AUTOMATION_MODE === "test";
}

export function getAutomationConcurrency() {
  const configured = Number(process.env.AUTOMATION_CONCURRENCY);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(Math.floor(configured), 6);
  }
  return isTestMode() ? 2 : 3;
}

export function isAdminProtected() {
  return Boolean(ADMIN_API_SECRET);
}

export function assertAdminAccess(request) {
  if (!ADMIN_API_SECRET) {
    return true;
  }

  const provided = request.headers.get("x-admin-secret");
  if (provided !== ADMIN_API_SECRET) {
    const error = new Error("Unauthorized. Enter the admin secret configured in your server .env file.");
    error.statusCode = 401;
    throw error;
  }

  return true;
}

export function logAutomationConfig() {
  logger.info("Automation configuration", {
    mode: AUTOMATION_MODE,
    concurrency: getAutomationConcurrency(),
    adminProtected: Boolean(ADMIN_API_SECRET)
  });
}

export const DEFAULT_IREMBO_ENTITY_ID =
  process.env.DEFAULT_IREMBO_ENTITY_ID || "da39aca5-e4cc-4edd-8df8-0e09399b1793";
