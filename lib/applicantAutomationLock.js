const inFlight = new Set();
const lastStartedAt = new Map();
const extendedCooldownUntil = new Map();
const forceNextRun = new Set();
const COOLDOWN_MS = Number(process.env.APPLICANT_AUTOMATION_COOLDOWN_MS || 3_000);
const RATE_LIMIT_COOLDOWN_MS = Number(process.env.IREMBO_RATE_LIMIT_COOLDOWN_MS || 120_000);

export function markApplicantRateLimited(applicantId) {
  extendedCooldownUntil.set(Number(applicantId), Date.now() + RATE_LIMIT_COOLDOWN_MS);
}

export function isProfileRateLimitError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("423") ||
    text.includes("rate limit") ||
    text.includes("temporarily busy") ||
    text.includes("auto-retry") ||
    text.includes("blocking profile") ||
    text.includes("profile api is cooling down") ||
    text.includes("cooling down") ||
    text.includes("blocked profile lookup") ||
    text.includes("irembo is busy")
  );
}

export function clearApplicantRateLimitCooldown(applicantId) {
  extendedCooldownUntil.delete(Number(applicantId));
  lastStartedAt.delete(Number(applicantId));
}

export function clearAutomationCooldown(applicantId) {
  lastStartedAt.delete(Number(applicantId));
}

export function markForceAutomationRun(applicantId) {
  forceNextRun.add(Number(applicantId));
}

export function consumeForceAutomationRun(applicantId) {
  const id = Number(applicantId);
  if (!forceNextRun.has(id)) {
    return false;
  }
  forceNextRun.delete(id);
  return true;
}

export function isApplicantAutomationRunning(applicantId) {
  return inFlight.has(Number(applicantId));
}

export function canStartApplicantAutomation(applicantId) {
  const id = Number(applicantId);
  if (inFlight.has(id)) {
    return false;
  }

  const extendedUntil = extendedCooldownUntil.get(id);
  if (extendedUntil && Date.now() < extendedUntil) {
    return false;
  }

  const last = lastStartedAt.get(id);
  return !last || Date.now() - last >= COOLDOWN_MS;
}

export function shouldDeferAutomation(applicant, options = {}) {
  if (!applicant) {
    return true;
  }

  const lastError = String(applicant.lastError || "").toLowerCase();
  const rateLimited =
    lastError.includes("423") ||
    lastError.includes("rate limit") ||
    lastError.includes("temporarily busy") ||
    lastError.includes("blocking profile") ||
    lastError.includes("getcitizenprofile timed out") ||
    lastError.includes("profile lookup");

  if (rateLimited) {
    const elapsed = Date.now() - new Date(applicant.updatedAt).getTime();
    if (elapsed < RATE_LIMIT_COOLDOWN_MS) {
      return true;
    }
  }

  if (options.force) {
    return false;
  }

  if (String(applicant.status || "").startsWith("FAILED")) {
    if (isProfileRateLimitError(applicant.lastError) || applicant.status === "FAILED_LOOKUP") {
      const elapsed = Date.now() - new Date(applicant.updatedAt).getTime();
      return elapsed < RATE_LIMIT_COOLDOWN_MS;
    }
    return true;
  }

  if (applicant.status === "PENDING" && applicant.provisionalLicenseNumber) {
    return false;
  }

  return !canStartApplicantAutomation(applicant.id);
}

export async function withApplicantAutomationLock(applicantId, fn, options = {}) {
  const id = Number(applicantId);
  if (!options.force && !canStartApplicantAutomation(id)) {
    return { skipped: true, reason: "COOLDOWN_OR_RUNNING" };
  }

  inFlight.add(id);
  lastStartedAt.set(id, Date.now());
  try {
    return await fn();
  } finally {
    inFlight.delete(id);
  }
}
