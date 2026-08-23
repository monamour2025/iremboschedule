import {
  APPLICATION_TYPE_ADD_CATEGORY,
  APPLICATION_TYPE_FIRST_LICENCE
} from "../lib/applicationTypes.js";
import {
  applicantOwnsCategory,
  parseIremboDisplayDate,
  parseVehicleClasses,
  primaryVehicleCategory
} from "../lib/vehicleClassParser.js";
import { getExistingDrivingLicense, getScheduleCategories } from "../providers/iremboApplicationProvider.js";
import {
  getApplicantById,
  setApplicantEntityId,
  setApplicantExistingLicense,
  setApplicantStatus
} from "./applicantService.js";
import { logAutomationEvent } from "./automationLogService.js";
import { cacheEntityId, tryResolveEntityIdForExistingLicense, getCachedEntityId } from "./entityIdService.js";
import { logger } from "../lib/logger.js";
import { hashNationalId } from "../lib/encryption.js";
import {
  nationalIdValidationMessage,
  normalizeNationalIdInput,
  uniqueNationalIdCandidates
} from "../lib/nationalId.js";

function buildDisplayName(profile, license) {
  if (profile?.displayName) {
    return profile.displayName;
  }
  const fromLicense = [license.lastName, license.firstName].filter(Boolean).join(" ").trim();
  return fromLicense || "Applicant";
}

function displayNameFromLicense(license, nameHint = "") {
  const hint = String(nameHint || "").trim();
  if (hint) {
    return hint;
  }
  return buildDisplayName(null, license);
}

function normalizeExistingLicenseResponse(license) {
  const categories = parseVehicleClasses(license.vehicleClass);
  return {
    id: license.id,
    number: license.licenseNumber,
    category: primaryVehicleCategory(license.vehicleClass) || categories[0] || null,
    categories,
    vehicleClass: String(license.vehicleClass || "").replace(/;$/, ""),
    status: license.status,
    documentType: license.documentType,
    expiryDate: license.expiryDate,
    issueDate: license.dateOfIssue,
    applicationNumber: license.applicationNumber,
    firstName: license.firstName,
    lastName: license.lastName,
    placeOfIssue: license.placeOfIssue,
    raw: license
  };
}

export async function fetchExistingLicenseForNationalId({ nationalId, fullName = "" }) {
  const normalizedId = normalizeNationalIdInput(nationalId);
  const validationMessage = nationalIdValidationMessage(normalizedId);
  if (validationMessage) {
    const error = new Error(validationMessage);
    error.statusCode = 400;
    throw error;
  }

  const startedAt = Date.now();
  const nameHint = String(fullName || "").trim();
  const nationalIdHash = hashNationalId(normalizedId);
  const cachedProfile = await getCachedEntityId(nationalIdHash);

  let license = null;
  let lastDlError = null;
  for (const candidate of uniqueNationalIdCandidates(normalizedId)) {
    try {
      license = await getExistingDrivingLicense(candidate);
      break;
    } catch (error) {
      lastDlError = error;
    }
  }

  if (!license) {
    throw lastDlError || new Error("Applicant does not appear to have an existing driving licence.");
  }

  const normalized = normalizeExistingLicenseResponse(license);
  const resolvedName = cachedProfile?.displayName || displayNameFromLicense(license, nameHint);
  let entityId = cachedProfile?.entityId || null;

  // Do not block Fetch licence on slow profile lookup — return licence immediately.
  // Entity ID is resolved in the background when missing (automation can also resolve later).
  if (!entityId) {
    void tryResolveEntityIdForExistingLicense({
      nationalId: normalizedId,
      fullName: resolvedName,
      existingLicense: license
    })
      .then(async (profile) => {
        if (!profile?.entityId) {
          return;
        }
        await cacheEntityId(nationalIdHash, profile.entityId, profile.displayName || resolvedName);
        logger.info("Resolved entity ID after licence fetch (background)", {
          fullName: resolvedName,
          entityId: profile.entityId,
          source: profile.source
        });
      })
      .catch(() => {});
  }

  return {
    entityId,
    fullName: resolvedName,
    existingLicense: normalized,
    durationMs: Date.now() - startedAt
  };
}

export function assertRequestedCategoryAllowed(existingCategories, requestedCategory) {
  const requested = String(requestedCategory || "").trim();
  if (!requested) {
    const error = new Error("Select the new category being requested.");
    error.statusCode = 400;
    throw error;
  }

  if (applicantOwnsCategory(existingCategories, requested)) {
    const error = new Error("Applicant already has this category.");
    error.statusCode = 400;
    throw error;
  }
}

export async function fetchAndPersistExistingLicense(applicantId, options = {}) {
  const applicant = await getApplicantById(applicantId, true);
  if (!applicant) {
    const error = new Error("Applicant not found.");
    error.statusCode = 404;
    throw error;
  }

  const nationalId = applicant.nationalIdFull;
  if (!nationalId) {
    const error = new Error("Unable to decrypt applicant national ID.");
    error.statusCode = 400;
    throw error;
  }

  await setApplicantStatus(applicantId, "FETCHING_PROFILE", null);

  const result = await fetchExistingLicenseForNationalId({
    nationalId,
    fullName: applicant.fullName
  });

  await logAutomationEvent({
    applicantId,
    action: "FETCH_PROFILE",
    requestPayload: { nationalId: "***" },
    responsePayload: { entityId: result.entityId, fullName: result.fullName },
    success: true
  });

  await setApplicantEntityId(applicantId, result.entityId);
  await cacheEntityId(hashNationalId(nationalId), result.entityId, result.fullName);

  await logAutomationEvent({
    applicantId,
    action: "FETCH_EXISTING_LICENSE",
    requestPayload: { nationalId: "***" },
    responsePayload: {
      number: result.existingLicense.number,
      category: result.existingLicense.category,
      status: result.existingLicense.status,
      vehicleClass: result.existingLicense.vehicleClass
    },
    success: true,
    durationMs: result.durationMs
  });

  const license = result.existingLicense.raw;
  await setApplicantExistingLicense(applicantId, {
    applicationType: APPLICATION_TYPE_ADD_CATEGORY,
    fullName: options.updateName === false ? undefined : result.fullName,
    entityId: result.entityId,
    existingLicenseId: license.id,
    existingLicenseNumber: license.licenseNumber,
    existingLicenseCategory: result.existingLicense.category,
    existingLicenseCategories: JSON.stringify(result.existingLicense.categories),
    existingLicenseExpiry: parseIremboDisplayDate(license.expiryDate),
    existingLicenseIssueDate: parseIremboDisplayDate(license.dateOfIssue),
    existingLicenseStatus: license.status,
    existingLicenseDocumentType: license.documentType,
    existingLicenseApplicationNumber: license.applicationNumber,
    existingLicenseVehicleClass: license.vehicleClass,
    requestedLicenseCategory: applicant.requestedLicenseCategory || null
  });

  await setApplicantStatus(applicantId, "EXISTING_LICENSE_FETCHED", null);

  const refreshed = await getApplicantById(applicantId, false);
  return {
    success: true,
    applicant: {
      ...refreshed,
      existingLicense: result.existingLicense
    }
  };
}

export async function listScheduleCategoriesFromIrembo() {
  return getScheduleCategories();
}

export function isExistingLicenseApplicant(applicant) {
  if (String(applicant?.applicationType || "").trim() === APPLICATION_TYPE_ADD_CATEGORY) {
    return true;
  }
  if (String(applicant?.existingLicenseNumber || "").trim()) {
    return true;
  }
  if (String(applicant?.existingLicenseDocumentType || "").trim().toUpperCase() === "DEFINITIVE") {
    return true;
  }
  return false;
}

export function isProvisionalLicenceValidationError(message) {
  const text = String(message || "").toLowerCase();
  return (
    text.includes("100007") ||
    text.includes("agateganyo") ||
    text.includes("provisional") ||
    text.includes("validate definitivelicense") ||
    text.includes("definitive validation")
  );
}

export function resolveAutomationLicenseCategory(applicant) {
  if (isExistingLicenseApplicant(applicant)) {
    return applicant.requestedLicenseCategory || applicant.licenseCategory;
  }
  return applicant.licenseCategory;
}

export function resolveAutomationLicenseNumber(applicant) {
  if (isExistingLicenseApplicant(applicant)) {
    return applicant.existingLicenseNumber;
  }
  return applicant.provisionalLicenseNumber;
}
