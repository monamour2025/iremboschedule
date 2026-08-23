import { logger } from "./logger.js";

export async function withRetry(fn, options = {}) {
  const maxRetries = Number(options.maxRetries ?? process.env.IREMBO_MAX_RETRIES ?? 3);
  const timeoutMs = Number(options.timeoutMs ?? process.env.IREMBO_REQUEST_TIMEOUT_MS ?? 30000);
  const baseDelayMs = Number(options.baseDelayMs ?? 500);
  const label = options.label || "request";

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await Promise.race([
        fn(attempt),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
    } catch (error) {
      lastError = error;
      const retryIf = options.retryIf;
      if (typeof retryIf === "function" && !retryIf(error)) {
        break;
      }
      if (attempt >= maxRetries) {
        break;
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      logger.warn("Retrying after failure", { label, attempt, delayMs, message: error.message });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
