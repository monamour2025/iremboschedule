import { prisma } from "../lib/db.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { logger } from "../lib/logger.js";
import { hashNationalId } from "../lib/encryption.js";
import { isValidNationalIdInput, normalizeNationalIdInput } from "../lib/nationalId.js";
import { getCitizenEntityIdByNationalId } from "../providers/iremboApplicationProvider.js";
import { bootstrapProfileSession } from "../lib/iremboProfileSession.js";

const PROFILE_LOOKUP_INTERVAL_MS = Number(process.env.PROFILE_LOOKUP_INTERVAL_MS || 800);
const PROFILE_423_BACKOFF_MS = Number(process.env.IREMBO_PROFILE_423_BACKOFF_MS || 600_000);
const ENTITY_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidEntityId(value) {
  return ENTITY_ID_REGEX.test(String(value || "").trim());
}

export function requireEntityIdInput(input, label = "Applicant") {
  const entityId = String(input?.entityId || "").trim();
  if (!entityId) {
    const error = new Error(
      `${label}: Irembo entity ID is required. Paste profileDto.entityId from irembo.gov.rw DevTools.`
    );
    error.statusCode = 400;
    throw error;
  }
  if (!isValidEntityId(entityId)) {
    const error = new Error(`${label}: Entity ID must be the UUID from Irembo profileDto.entityId.`);
    error.statusCode = 400;
    throw error;
  }
  return entityId;
}
let profileLookupChain = Promise.resolve();
let lastProfileLookupAt = 0;
let lastProfile423At = 0;

async function withProfileLookupSlot(fn) {
  const run = async () => {
    const waitMs = Math.max(0, PROFILE_LOOKUP_INTERVAL_MS - (Date.now() - lastProfileLookupAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastProfileLookupAt = Date.now();
    return fn();
  };

  const next = profileLookupChain.then(run, run);
  profileLookupChain = next.catch(() => {});
  return next;
}

export function maskEntityId(entityId) {
  const value = String(entityId || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function buildNameVariants(fullName, verifiedDisplayName = null) {
  const variants = new Set();
  const normalized = String(fullName || "")
    .trim()
    .replace(/\s+/g, " ");
  if (normalized) {
    variants.add(normalized);
  }
  if (verifiedDisplayName) {
    variants.add(String(verifiedDisplayName).trim().replace(/\s+/g, " "));
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length >= 2) {
    const surname = parts[0];
    const givenNames = parts.slice(1).join(" ");
    variants.add(`${givenNames} ${surname}`);
    variants.add(`${parts[1]} ${surname}`);
    if (parts.length >= 3) {
      variants.add(`${parts[1]} ${parts[2]} ${surname}`);
    }
  }

  return [...variants].filter(Boolean);
}

export async function getCachedEntityId(nationalIdHash) {
  await ensureDatabaseSchema();
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "entityId", "displayName", "resolvedAt"
    FROM "CitizenProfileCache"
    WHERE "nationalIdHash" = '${String(nationalIdHash).replaceAll("'", "''")}'
    LIMIT 1
  `);
  return rows?.[0] || null;
}

export async function cacheEntityId(nationalIdHash, entityId, displayName = null) {
  await ensureDatabaseSchema();
  const hash = String(nationalIdHash).replaceAll("'", "''");
  const id = String(entityId).replaceAll("'", "''");
  const name = displayName ? `'${String(displayName).replaceAll("'", "''")}'` : "NULL";
  await prisma.$executeRawUnsafe(`
    INSERT INTO "CitizenProfileCache" ("nationalIdHash", "entityId", "displayName", "resolvedAt")
    VALUES ('${hash}', '${id}', ${name}, CURRENT_TIMESTAMP)
    ON CONFLICT ("nationalIdHash") DO UPDATE SET
      "entityId" = EXCLUDED."entityId",
      "displayName" = EXCLUDED."displayName",
      "resolvedAt" = CURRENT_TIMESTAMP
  `);
}

function formatProfileError(error, fullName) {
  const message = String(error?.message || "Profile lookup failed.");
  const label = String(fullName || "").trim() || "this applicant";
  if (message.includes("423") || message.includes("blocking profile") || message.includes("cooling down")) {
    markProfileLookupRateLimited();
    const blockedMs = getProfileLookupBlockedMs();
    if (blockedMs > 0) {
      const minutes = Math.ceil(blockedMs / 60_000);
      return `Irembo is busy for ${label}. Auto-retry in ~${minutes} min — no action needed.`;
    }
    return `Irembo is busy for ${label}. Auto-retrying profile link…`;
  }
  if (!String(fullName || "").trim()) {
    return "Enter full name exactly as printed on the national ID.";
  }
  if (message.toLowerCase().includes("name") || message.toLowerCase().includes("verification")) {
    return `Could not verify ${label}: use the exact name as printed on the national ID.`;
  }
  return `Could not verify ${label} on Irembo: ${message}`;
}

export function markProfileLookupRateLimited() {
  lastProfile423At = Date.now();
}

export function getProfileLookupBlockedMs() {
  const elapsed = Date.now() - lastProfile423At;
  return lastProfile423At ? Math.max(0, PROFILE_423_BACKOFF_MS - elapsed) : 0;
}

export function assertProfileLookupNotBlocked() {
  const remainingMs = getProfileLookupBlockedMs();
  if (remainingMs <= 0) {
    return;
  }
  const minutes = Math.ceil(remainingMs / 60_000);
  const error = new Error(
    `Irembo profile API is busy (~${minutes} min). Auto-retry is scheduled — wait, do not click Retry repeatedly.`
  );
  error.statusCode = 429;
  throw error;
}

/** Save time: manual entity ID, cache, or live Irembo lookup when prefetch is enabled. */
export async function resolveEntityIdForInput({
  nationalId,
  fullName,
  entityId = null,
  prefetch = false
}) {
  await ensureDatabaseSchema();

  const normalizedId = normalizeNationalIdInput(nationalId);
  const normalizedName = String(fullName || "").trim();
  const manualEntityId = String(entityId || "").trim();

  if (manualEntityId) {
    return { entityId: manualEntityId, source: "manual", displayName: normalizedName };
  }

  if (!isValidNationalIdInput(normalizedId)) {
    const error = new Error("National ID must be 13 or 16 digits.");
    error.statusCode = 400;
    throw error;
  }

  const nationalIdHash = hashNationalId(normalizedId);
  const cached = await getCachedEntityId(nationalIdHash);
  if (cached?.entityId) {
    return {
      entityId: cached.entityId,
      source: "cache",
      displayName: cached.displayName || normalizedName
    };
  }

  if (prefetch) {
    try {
      return await prefetchEntityId({ nationalId: normalizedId, fullName: normalizedName });
    } catch {
      return { entityId: null, source: "pending", displayName: normalizedName };
    }
  }

  return { entityId: null, source: "pending", displayName: normalizedName };
}

/** Called when national ID is entered in the form — same timing as Irembo's public form. */
export async function prefetchEntityId({ nationalId, fullName }) {
  return lookupEntityIdFromIrembo({ nationalId, fullName });
}

/** Automation time: same anonymous Irembo lookup as the public application form. */
export async function lookupEntityIdFromIrembo({ nationalId, fullName, existingLicense = null }) {
  await ensureDatabaseSchema();

  const normalizedId = normalizeNationalIdInput(nationalId);
  const normalizedName = String(fullName || "").trim();
  if (!isValidNationalIdInput(normalizedId)) {
    throw new Error("National ID must be 13 or 16 digits.");
  }

  const nationalIdHash = hashNationalId(normalizedId);
  const cached = await getCachedEntityId(nationalIdHash);
  if (cached?.entityId) {
    return {
      entityId: cached.entityId,
      source: "cache",
      displayName: cached.displayName || normalizedName
    };
  }

  await bootstrapProfileSession(false);

  const retryDelaysMs = [0, 2500];
  let lastError = null;
  const profileOptions = {
    fullName: normalizedName,
    existingLicense,
    skipLicenseLookups: Boolean(existingLicense)
  };

  for (let attempt = 0; attempt < retryDelaysMs.length; attempt += 1) {
    if (retryDelaysMs[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
    }

    try {
      const profile = await withProfileLookupSlot(() =>
        getCitizenEntityIdByNationalId(normalizedId, profileOptions)
      );
      await cacheEntityId(nationalIdHash, profile.entityId, profile.displayName || normalizedName);
      logger.info("Resolved Irembo entity ID", {
        fullName: profile.displayName || normalizedName,
        entityId: profile.entityId,
        source: profile.source,
        attempt: attempt + 1
      });
      return {
        entityId: profile.entityId,
        source: profile.source || "irembo",
        displayName: profile.displayName || normalizedName
      };
    } catch (error) {
      lastError = error;
      if (!String(error.message).includes("423")) {
        break;
      }
    }
  }

  throw new Error(formatProfileError(lastError, normalizedName));
}

/** Best-effort profile link after licence fetch — never throws. */
export async function tryResolveEntityIdForExistingLicense({ nationalId, fullName, existingLicense }) {
  try {
    return await lookupEntityIdFromIrembo({ nationalId, fullName, existingLicense });
  } catch {
    return null;
  }
}

export async function ensureBatchProfilesReady(batchId) {
  const { decryptNationalId } = await import("../lib/encryption.js");
  const { setApplicantEntityId, setApplicantStatus } = await import("./applicantService.js");

  const applicants = await prisma.applicant.findMany({
    where: { batchId: Number(batchId) },
    orderBy: { createdAt: "asc" }
  });

  if (applicants.length === 0) {
    const error = new Error("Add applicants to the list before automating.");
    error.statusCode = 400;
    throw error;
  }

  let remaining = 0;
  for (const applicant of applicants) {
    if (applicant.entityId) {
      continue;
    }

    const blockedMs = getProfileLookupBlockedMs();
    if (blockedMs > 0) {
      remaining += 1;
      await setApplicantStatus(
        applicant.id,
        "PENDING",
        formatProfileError(new Error("423"), applicant.fullName)
      );
      continue;
    }

    const nationalId = decryptNationalId(applicant.nationalIdEnc);
    if (!nationalId) {
      remaining += 1;
      continue;
    }

    try {
      const profile = await lookupEntityIdFromIrembo({
        nationalId,
        fullName: applicant.fullName
      });
      await setApplicantEntityId(applicant.id, profile.entityId);
    } catch (error) {
      remaining += 1;
      await setApplicantStatus(applicant.id, "PENDING", formatProfileError(error, applicant.fullName));
    }
  }

  return { ok: true, remaining, count: applicants.length };
}

export async function processFailedProfileLookups() {
  if (getProfileLookupBlockedMs() > 0) {
    return 0;
  }

  const { decryptNationalId } = await import("../lib/encryption.js");
  const { setApplicantEntityId, setApplicantStatus } = await import("./applicantService.js");
  const { enqueueApplicantAutomation } = await import("../lib/automationQueue.js");
  const { isProfileRateLimitError } = await import("../lib/applicantAutomationLock.js");

  const candidates = await prisma.applicant.findMany({
    where: {
      entityId: null,
      status: { in: ["SAVED", "PENDING", "FAILED_LOOKUP", "FAILED"] }
    },
    orderBy: { updatedAt: "asc" },
    take: 3
  });

  let processed = 0;
  for (const applicant of candidates) {
    const lastError = String(applicant.lastError || "");
    const profileRetry =
      applicant.status === "FAILED_LOOKUP" ||
      applicant.status === "SAVED" ||
      applicant.status === "FAILED" ||
      (applicant.status === "PENDING" && isProfileRateLimitError(lastError)) ||
      (applicant.status === "FAILED" && isProfileRateLimitError(lastError));

    if (!profileRetry) {
      continue;
    }

    const elapsed = Date.now() - new Date(applicant.updatedAt).getTime();
    if (elapsed < PROFILE_LOOKUP_INTERVAL_MS) {
      continue;
    }

    const nationalId = decryptNationalId(applicant.nationalIdEnc);
    if (!nationalId) {
      continue;
    }

    try {
      const profile = await lookupEntityIdFromIrembo({
        nationalId,
        fullName: applicant.fullName
      });
      await setApplicantEntityId(applicant.id, profile.entityId);
      await setApplicantStatus(applicant.id, "PENDING", null);
      if (applicant.assignedScheduleId || applicant.examCenter) {
        await enqueueApplicantAutomation(applicant.id, { force: true });
      }
      processed += 1;
    } catch (error) {
      await setApplicantStatus(applicant.id, "PENDING", formatProfileError(error, applicant.fullName));
    }
  }

  return processed;
}

export async function repairStuckProfileApplicants() {
  const { setApplicantStatus } = await import("./applicantService.js");
  const { isProfileRateLimitError } = await import("../lib/applicantAutomationLock.js");

  const stuck = await prisma.applicant.findMany({
    where: {
      entityId: null,
      status: { in: ["FAILED", "FAILED_LOOKUP"] }
    }
  });

  let repaired = 0;
  for (const applicant of stuck) {
    if (!isProfileRateLimitError(applicant.lastError) && applicant.status !== "FAILED_LOOKUP") {
      continue;
    }
    await setApplicantStatus(
      applicant.id,
      "PENDING",
      `Irembo is busy for ${applicant.fullName}. Auto-retry running — wait, no clicks needed.`
    );
    if (applicant.batchId) {
      await prisma.automationBatch.updateMany({
        where: {
          id: applicant.batchId,
          status: "COMPLETED"
        },
        data: {
          status: "RUNNING",
          completedAt: null
        }
      });
    }
    repaired += 1;
  }

  return repaired;
}

export async function processPendingEntityIdLookups() {
  return processFailedProfileLookups();
}

export async function applyCachedEntityIdToApplicant() {
  return null;
}

export async function resolveEntityIdForApplicant() {
  return { ok: false, deprecated: true };
}

export async function resolveBatchEntityIds(batchId) {
  return ensureBatchProfilesReady(batchId);
}
