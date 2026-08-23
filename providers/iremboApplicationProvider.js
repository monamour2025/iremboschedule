import axios from "axios";
import { withRetry } from "../lib/retry.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { getIremboCitizenAuthHeaders, hasIremboCitizenCredentials } from "../lib/iremboCitizenAuth.js";
import { bootstrapProfileSession } from "../lib/iremboProfileSession.js";
import {
  extractIremboApplicationNumber,
  isExistingApplicationMessage
} from "../lib/iremboApplicationNumbers.js";
import { extractBookableScheduleId, extractGuidFromRow, extractRawScheduleId, isBookableScheduleId } from "../lib/scheduleIds.js";
import { captureIremboResponseCookies, getEncryptionKeys, getIremboSessionHeaders, queryFilteredSchedules, queryPoliceRequest } from "./iremboProvider.js";
import { logger } from "../lib/logger.js";
import {
  formatScheduleDateLocal,
  formatScheduleTimeLocal,
  parseIremboLocalDateTime,
  parseTimeRange,
  resolveRowStartDateTime,
  timeIsWithinRange,
  timeMatchesRequestedSlot
} from "../lib/scheduleTime.js";
import { resolveIremboNotificationContact } from "../lib/iremboContact.js";
import { isValidNationalIdInput, normalizeNationalIdInput } from "../lib/nationalId.js";

const BASE_URL = process.env.IREMBO_BASE_URL || "https://irembo.gov.rw/irembo/rest/public";

const DDL_REFERER =
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";

function buildPoliceBookingHeaders(examScheduleId, context = {}) {
  return {
    scheduleid: examScheduleId,
    scheduleId: examScheduleId,
    service: context.service || process.env.IREMBO_SERVICE || "PRACTICAL_EXAM",
    beneficiaries: context.beneficiaries || process.env.IREMBO_BENEFICIARIES || "PrivateCandidate",
    category: context.category,
    location: context.location,
    Referer: DDL_REFERER
  };
}

function buildAxiosError(error, label) {
  if (!error.response) {
    return new Error(`${label} failed: ${error.message}`);
  }

  const status = error.response.status;
  const body = error.response.data;
  const detail = body?.message || body?.error || error.message;

  if (status === 423) {
    if (label === "getCitizenProfile" || label.includes("Citizen") || label.includes("Profile") || label.includes("EntityId")) {
      return new Error(
        "Irembo is temporarily blocking profile lookups (HTTP 423). Wait 10+ minutes, or paste the entity ID from the browser."
      );
    }
    return new Error("Slot locked or no longer available (HTTP 423). The slot may already be taken.");
  }

  return new Error(`${label} failed (HTTP ${status}): ${detail || "Unknown error"}`);
}

async function buildHeaders(extra = {}) {
  const sessionHeaders = await getIremboSessionHeaders();
  return {
    ...sessionHeaders,
    ...extra
  };
}

function assertSuccess(payload, label) {
  if (!payload || payload.status === false) {
    const message = String(payload?.message || `${label} failed`).trim();
    const code = payload?.responseCode ? ` (${payload.responseCode})` : "";
    if (message.toLowerCase().includes("gahunda yibizamini") || message.toLowerCase().includes("irimo ikosa")) {
      throw new Error(
        `Irembo rejected this exam slot (schedule error${code}). Trying the next open slot.`
      );
    }
    throw new Error(message ? `${message}${code}` : `${label} failed`);
  }
  return payload;
}

async function postJson(url, body, headers, label, options = {}) {
  const headerBuilder = options.useProfileSession ? buildProfileRequestHeaders : buildHeaders;
  try {
    const response = await axios.post(url, body, {
      headers: await headerBuilder(headers),
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 500
    });
    captureIremboResponseCookies(response.headers);

    if (response.status >= 400) {
      throw buildAxiosError({ response }, label);
    }

    return response.data;
  } catch (error) {
    if (error.message?.includes("HTTP")) {
      throw error;
    }
    throw buildAxiosError(error, label);
  }
}

async function getJson(url, options = {}, label) {
  const config = typeof options === "object" && options !== null ? options : {};
  const params = config.params;
  const extraHeaders = config.headers || {};
  const headerBuilder = config.headerBuilder;

  try {
    const response = await axios.get(url, {
      params,
      headers: headerBuilder ? await headerBuilder(extraHeaders) : await buildHeaders(extraHeaders),
      timeout: 30000,
      validateStatus: (status) => status >= 200 && status < 500
    });
    captureIremboResponseCookies(response.headers);

    if (response.status >= 400) {
      throw buildAxiosError({ response }, label);
    }

    return response.data;
  } catch (error) {
    if (error.message?.includes("HTTP")) {
      throw error;
    }
    throw buildAxiosError(error, label);
  }
}

const SERVICE_CODE = "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";
export const SUPPLEMENTARY_SERVICE_CODE = "REGISTRATION_FOR_DRIVING_LICENSE_TEST_SUPPLEMENTARY";

const SUPPLEMENTARY_REFERER =
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_SUPPLEMENTARY";

const districtCache = new Map();
const approvingOfficeCache = new Map();

function normalizeExamLanguage(value) {
  const normalized = String(value || "English").trim().toUpperCase();
  if (normalized === "FRENCH" || normalized === "FRANCAIS" || normalized === "FR") {
    return "FRENCH";
  }
  if (normalized === "KINYARWANDA" || normalized === "KIN" || normalized === "RW") {
    return "KINYARWANDA";
  }
  return "ENGLISH";
}

async function getDistrictByName(locationName) {
  const normalized = String(locationName || "").trim();
  if (!normalized) {
    throw new Error("District name is required to resolve approving office.");
  }

  if (districtCache.has(normalized)) {
    return districtCache.get(normalized);
  }

  const payload = assertSuccess(
    await getJson(`${BASE_URL}/location/district`, {}, "getDistricts"),
    "getDistricts"
  );

  const districts = payload.data || [];
  const district = districts.find(
    (entry) => String(entry.name || "").trim().toLowerCase() === normalized.toLowerCase()
  );
  if (!district?.guid) {
    throw new Error(`District not found for approving office lookup: ${normalized}`);
  }

  districtCache.set(normalized, district);
  return district;
}

export async function resolveApprovingOfficeLocationId(locationName) {
  const normalized = String(locationName || "").trim();
  if (!normalized) {
    throw new Error("District name is required to resolve approving office.");
  }

  if (approvingOfficeCache.has(normalized)) {
    return approvingOfficeCache.get(normalized);
  }

  const district = await getDistrictByName(normalized);
  const payload = assertSuccess(
    await getJson(
      `${BASE_URL}/office/`,
      {
        headers: {
          applicationCode: SERVICE_CODE,
          locationId: district.guid
        }
      },
      "getApprovingOffices"
    ),
    "getApprovingOffices"
  );

  const office = (payload.data || []).find((entry) => entry?.guid);
  if (!office?.guid) {
    throw new Error(`No approving office found for district ${normalized}.`);
  }

  approvingOfficeCache.set(normalized, office.guid);
  return office.guid;
}

function buildProfileContext(nationalId, options = {}) {
  const normalizedId = String(nationalId).trim();
  const verificationValue = String(options.fullName || options.verificationValue || "")
    .trim()
    .replace(/\s+/g, " ");

  return {
    identificationNumber: normalizedId,
    identificationType: "NATIONAL_IDENTIFICATION",
    serviceCode: SERVICE_CODE,
    verificationMethod: "NAME",
    verificationValue
  };
}

async function profileLookupUrls() {
  const publicBase = process.env.IREMBO_BASE_URL || "https://irembo.gov.rw/irembo/rest/public";
  return [`${publicBase}/record/external/id`, `${publicBase}/record/external`];
}

function extractProfileDto(payload) {
  const profile = payload?.data?.profileDto;
  if (!profile?.entityId) {
    throw new Error("Citizen profile missing entityId");
  }
  return {
    entityId: profile.entityId,
    displayName: profile.displayName,
    nationalId: profile.nationalId,
    registrationNumber: profile.registrationNumber || null
  };
}

/** Resolve entityId from national ID — same public Irembo API as the web form. */
export async function getCitizenEntityIdByNationalId(nationalId, options = {}) {
  const normalizedId = normalizeNationalIdInput(nationalId);
  if (!isValidNationalIdInput(normalizedId)) {
    throw new Error("National ID must be 13 or 16 digits for Irembo profile lookup.");
  }

  const keys = getEncryptionKeys();
  const publicBase = process.env.IREMBO_BASE_URL || "https://irembo.gov.rw/irembo/rest/public";

  const nameCandidates = [];
  const formName = String(options.fullName || "").trim();
  if (formName) {
    nameCandidates.push(formName);
  }

  const existingLicense = options.existingLicense || null;
  if (existingLicense?.lastName && existingLicense?.firstName) {
    nameCandidates.push(`${existingLicense.lastName} ${existingLicense.firstName}`.trim());
    nameCandidates.push(`${existingLicense.firstName} ${existingLicense.lastName}`.trim());
  }

  if (!options.skipLicenseLookups) {
    try {
      const license = await validateDefinitiveLicense(normalizedId);
      if (license.lastName && license.firstName) {
        nameCandidates.push(`${license.lastName} ${license.firstName}`.trim());
        nameCandidates.push(`${license.firstName} ${license.lastName}`.trim());
      }
      if (license.displayName) {
        nameCandidates.push(license.displayName.trim());
      }
    } catch {
      // Licence validation supplies the best verification name when available.
    }

    if (!existingLicense) {
      try {
        const license = await getExistingDrivingLicense(normalizedId);
        if (license.lastName && license.firstName) {
          nameCandidates.push(`${license.lastName} ${license.firstName}`.trim());
          nameCandidates.push(`${license.firstName} ${license.lastName}`.trim());
        }
      } catch {
        // Existing definitive licence lookup helps add-category profile resolution.
      }
    }
  }

  const uniqueNames = [...new Set(nameCandidates.filter(Boolean))];
  if (uniqueNames.length === 0) {
    throw new Error("Full name is required for Irembo profile lookup.");
  }

  async function lookupOnce() {
    if (hasIremboCitizenCredentials()) {
      const authHeaders = await getIremboCitizenAuthHeaders();
      for (const candidateName of uniqueNames) {
        const profileContext = buildProfileContext(normalizedId, { fullName: candidateName });
        const payload = assertSuccess(
          await getJson(
            "https://irembo.gov.rw/irembo/rest/record/external",
            {
              headerBuilder: (extra) =>
                buildProfileRequestHeaders({
                  ...extra,
                  ...profileContext,
                  RPK: keys.publicKeyB64,
                  ...authHeaders
                })
            },
            "getCitizenProfile"
          ),
          "getCitizenProfile"
        );
        return { ...extractProfileDto(payload), source: "irembo-auth" };
      }
    }

    for (const candidateName of uniqueNames) {
      try {
        const profileContext = buildProfileContext(normalizedId, { fullName: candidateName });
        const payload = assertSuccess(
          await getJson(
            `${publicBase}/record/external`,
            {
              headerBuilder: (extra) =>
                buildProfileRequestHeaders({
                  ...extra,
                  ...profileContext,
                  RPK: keys.publicKeyB64
                })
            },
            "getCitizenProfile"
          ),
          "getCitizenProfile"
        );
        return { ...extractProfileDto(payload), source: "irembo-profile" };
      } catch (error) {
        if (String(error.message).includes("423")) {
          throw error;
        }
      }
    }

    throw new Error("Irembo profile lookup failed.");
  }

  return lookupOnce();
}

export async function getCitizenProfile(nationalId, options = {}) {
  const normalizedId = normalizeNationalIdInput(nationalId);
  if (!isValidNationalIdInput(normalizedId)) {
    throw new Error("National ID must be 13 or 16 digits for Irembo profile lookup.");
  }

  const profileContext = buildProfileContext(normalizedId, options);
  const keys = getEncryptionKeys();
  const rateLimitWaitMs = Number(process.env.IREMBO_PROFILE_RATE_LIMIT_WAIT_MS || 15_000);
  const max423Retries = Number(process.env.IREMBO_PROFILE_423_RETRIES || 0);

  let lastError = null;
  for (const url of await profileLookupUrls()) {
    for (let rateLimitAttempt = 0; rateLimitAttempt <= max423Retries; rateLimitAttempt += 1) {
      try {
        const payload = assertSuccess(
          await withRetry(
            () =>
              getJson(
                url,
                {
                  headerBuilder: (extra) =>
                    buildProfileRequestHeaders({
                      ...extra,
                      ...profileContext,
                      RPK: keys.publicKeyB64
                    })
                },
                "getCitizenProfile"
              ),
            { label: "getCitizenProfile", maxRetries: 1, timeoutMs: 30000 }
          ),
          "getCitizenProfile"
        );

        const profile = payload.data?.profileDto;
        if (!profile?.entityId) {
          throw new Error("Citizen profile missing entityId");
        }

        return {
          entityId: profile.entityId,
          displayName: profile.displayName,
          nationalId: profile.nationalId,
          registrationNumber: profile.registrationNumber || null
        };
      } catch (error) {
        lastError = error;
        const is423 = String(error.message).includes("423");
        if (is423 && rateLimitAttempt < max423Retries) {
          logger.warn("Profile lookup rate-limited; waiting before retry", {
            url,
            attempt: rateLimitAttempt + 1,
            waitMs: rateLimitWaitMs,
            fullName: profileContext.verificationValue
          });
          await new Promise((resolve) => setTimeout(resolve, rateLimitWaitMs));
          continue;
        }
        if (!is423) {
          throw error;
        }
      }
    }
  }

  throw lastError || new Error("Irembo profile lookup failed.");
}

/**
 * GET /police/v2/request/schedule-categories
 * Returns available driving licence categories from Irembo (not hard-coded).
 */
const DEFAULT_SCHEDULE_CATEGORIES = ["A", "B", "B(AT)", "C", "D", "D1", "E", "F"];
let cachedScheduleCategories = null;
let cachedScheduleCategoriesAt = 0;
const SCHEDULE_CATEGORY_CACHE_MS = Number(process.env.IREMBO_CATEGORY_CACHE_MS || 3600000);

export function getDefaultScheduleCategories() {
  return [...DEFAULT_SCHEDULE_CATEGORIES];
}

export async function getScheduleCategories() {
  if (cachedScheduleCategories && Date.now() - cachedScheduleCategoriesAt < SCHEDULE_CATEGORY_CACHE_MS) {
    return cachedScheduleCategories;
  }

  const categories = await queryPoliceRequest("schedule-categories");
  if (!Array.isArray(categories)) {
    throw new Error("schedule-categories did not return a category list.");
  }

  cachedScheduleCategories = categories.map((entry) => String(entry || "").trim()).filter(Boolean);
  cachedScheduleCategoriesAt = Date.now();
  return cachedScheduleCategories;
}

/**
 * GET /police/v2/request/get-dl-by-national-id
 * Returns an existing definitive driving licence for add-category workflows.
 */
export async function getExistingDrivingLicense(nationalId) {
  const normalizedId = normalizeNationalIdInput(nationalId);
  if (!isValidNationalIdInput(normalizedId)) {
    throw new Error("National ID must be 13 or 16 digits.");
  }

  const lookupTimeoutMs = Number(process.env.IREMBO_LICENSE_LOOKUP_TIMEOUT_MS || 12000);

  try {
    await bootstrapProfileSession(false);
  } catch {
    // Continue with warmed anonymous session.
  }

  const data = await withRetry(
    () =>
      queryPoliceRequest(
        "get-dl-by-national-id",
        {},
        {
          nationalid: normalizedId,
          nationalId: normalizedId,
          Referer: DDL_REFERER
        },
        { timeoutMs: lookupTimeoutMs, maxAttempts: 1 }
      ),
    {
      label: "getExistingDrivingLicense",
      maxRetries: 1,
      timeoutMs: lookupTimeoutMs + 2000,
      baseDelayMs: 400,
      retryIf: (error) => /timed out|ECONNABORTED|network|429|502|503|504/i.test(error.message)
    }
  );

  const license = data?.license;
  if (!license?.licenseNumber) {
    throw new Error(
      "Applicant does not appear to have an existing driving licence. Use First Licence instead."
    );
  }

  const status = String(license.status || "").trim().toUpperCase();
  if (status && status !== "ACTIVE") {
    throw new Error("Existing driving licence is not ACTIVE.");
  }

  const documentType = String(license.documentType || "").trim().toUpperCase();
  if (documentType && documentType !== "DEFINITIVE") {
    throw new Error(`Existing licence document type is ${license.documentType || "unknown"}, not DEFINITIVE.`);
  }

  return {
    id: license.id || null,
    firstName: license.firstName || "",
    lastName: license.lastName || "",
    nid: license.nid || normalizedId,
    licenseNumber: license.licenseNumber,
    dob: license.dob || null,
    sex: license.sex || null,
    expiryDate: license.expiryDate || null,
    placeOfIssue: license.placeOfIssue || null,
    vehicleClass: license.vehicleClass || null,
    applicationNumber: license.applicationNumber || null,
    documentType: license.documentType || null,
    status: license.status || null,
    dateOfIssue: license.dateOfIssue || null,
    nationality: license.nationality || null,
    placeOfBirth: license.placeOfBirth || null,
    documentNumber: license.documentNumber || null
  };
}

export async function validateDefinitiveLicense(nationalId) {
  const normalizedId = String(nationalId).trim();
  if (!/^\d{16}$/.test(normalizedId)) {
    throw new Error("National ID must be exactly 16 digits for licence validation.");
  }

  const payload = assertSuccess(
    await withRetry(
      () =>
        postJson(
          `${BASE_URL}/police/v2/request/registration-validation/definitive`,
          { nationalId: normalizedId },
          { "Content-Type": "application/json" },
          "validateDefinitiveLicense",
          { useProfileSession: true }
        ),
      { label: "validateDefinitiveLicense", maxRetries: 2, timeoutMs: 30000 }
    ),
    "validateDefinitiveLicense"
  );

  const license = payload.data?.license;
  if (!license?.licenseNumber) {
    throw new Error("Definitive validation did not return a provisional licence number.");
  }

  return {
    licenseNumber: license.licenseNumber,
    dateOfExpiry: license.dateOfExpiry || null,
    firstName: license.firstName || "",
    lastName: license.lastName || "",
    displayName: [license.firstName, license.lastName].filter(Boolean).join(" ").trim()
  };
}

function policeHeaders(category, location) {
  return {
    category,
    location
  };
}

async function listLiveScheduleCandidates({
  licenseCategory,
  location,
  examCenter,
  examDate,
  examTime
}) {
  const selectedDate = formatScheduleDateLocal(examDate);
  const headers = policeHeaders(licenseCategory, location);
  const centers = (await queryPoliceRequest("test-centers", { selectedDate }, headers)) || [];
  const timeRanges =
    (await queryPoliceRequest("time-ranges", { selectedDate }, headers)) || ["07:00 - 09:00"];

  const preferredCenters = (
    examCenter
      ? [examCenter]
      : centers
  ).filter(Boolean);

  const candidates = [];
  for (const testCenter of preferredCenters) {
    for (const range of timeRanges) {
      const { startTime, endTime } = parseTimeRange(range);
      if (examTime && startTime !== examTime && !timeIsWithinRange(examTime, startTime, endTime)) {
        continue;
      }

      const rows = await queryFilteredSchedules({
        category: licenseCategory,
        location,
        page: 1,
        limit: 20,
        selectedDate,
        startTime,
        endTime,
        testCenter
      });

      for (const row of rows) {
        const bookableId = extractBookableScheduleId(row);
        if (!isBookableScheduleId(bookableId)) {
          continue;
        }

        const rowStart = resolveRowStartDateTime(row, { selectedDate, startTime });
        const candidateTime = rowStart ? formatScheduleTimeLocal(rowStart) : startTime;
        if (!timeMatchesRequestedSlot(examTime, startTime, endTime, candidateTime)) {
          continue;
        }

        const resolvedTime = examTime || candidateTime;
        candidates.push({
          examScheduleId: bookableId,
          examCenter: row.center || row.testCenter || testCenter,
          examDate: parseIremboLocalDateTime(selectedDate, resolvedTime),
          examTime: resolvedTime,
          schedule: row,
          testCenter,
          locationName: row.locationName || location,
          amount: Number(row.price ?? row.examFee ?? 0) || null
        });
      }
    }
  }

  return candidates;
}

export async function findExamSchedule({
  licenseCategory,
  examCenter,
  examDate,
  examTime,
  location
}) {
  const candidates = await listLiveScheduleCandidates({
    licenseCategory,
    location,
    examCenter,
    examDate,
    examTime
  });

  if (candidates.length === 0) {
    const selectedDate = formatScheduleDateLocal(examDate);
    throw new Error(
      `No live schedule found for ${examCenter} on ${selectedDate} at ${examTime} (${location})`
    );
  }

  const match = candidates[0];
  return {
    examScheduleId: match.examScheduleId,
    schedule: match.schedule,
    selectedDate: new Date(examDate).toISOString().slice(0, 10),
    startTime: match.examTime,
    endTime: match.examTime,
    location,
    locationName: match.locationName || location,
    amount: match.amount,
    examCenter: match.examCenter,
    examDate: match.examDate,
    examTime: match.examTime
  };
}

export async function listBookableSchedulesForApplicant(applicant, assignedSchedule) {
  return listLiveScheduleCandidates({
    licenseCategory: applicant.licenseCategory,
    location: applicant.preferredLocation,
    examCenter: assignedSchedule.examCenter,
    examDate: assignedSchedule.examDate,
    examTime: assignedSchedule.examTime
  });
}

export async function resolveLiveScheduleForApplicant(applicant, assignedSchedule) {
  return findExamSchedule({
    licenseCategory: applicant.licenseCategory,
    examCenter: assignedSchedule.examCenter,
    examDate: assignedSchedule.examDate,
    examTime: assignedSchedule.examTime,
    location: applicant.preferredLocation
  });
}

export async function reserveTemporarySlot(examScheduleId, context = {}) {
  const bookingHeaders = buildPoliceBookingHeaders(examScheduleId, context);
  const payload = assertSuccess(
    await withRetry(
      () =>
        postJson(
          `${BASE_URL}/police/v2/request/book-slot-temporary`,
          null,
          bookingHeaders,
          "reserveTemporarySlot",
          { useProfileSession: true }
        ),
      { label: "reserveTemporarySlot", retryIf: (error) => !String(error.message).includes("423"), maxRetries: 2, timeoutMs: 12000 }
    ),
    "reserveTemporarySlot"
  );

  const temporaryBookingId = payload.data;
  if (!temporaryBookingId) {
    throw new Error("Temporary booking id missing from reserve slot response");
  }

  return String(temporaryBookingId);
}

export async function createDrivingLicenseApplication(input) {
  const serviceCode = input.serviceCode || SERVICE_CODE;
  const isSupplementary = serviceCode === SUPPLEMENTARY_SERVICE_CODE;
  const createUrl = isSupplementary
    ? `${BASE_URL}/police/v2/create/dl-registration/supplementary/application`
    : `${BASE_URL}/police/v2/create/ddl-registration/application`;
  const createLabel = isSupplementary
    ? "createSupplementaryDrivingLicenseApplication"
    : "createDrivingLicenseApplication";

  const examLanguage = normalizeExamLanguage(input.examLanguage);
  const locationName = input.locationName || input.preferredLocation;
  const approvingOfficeLocationId =
    input.approvingOfficeLocationId || (await resolveApprovingOfficeLocationId(locationName));
  const { notificationPhone, notificationEmail } = resolveIremboNotificationContact({
    phone: input.phone,
    email: input.email
  });

  const body = {
    requesterId: input.entityId,
    applicantId: input.entityId,
    creatorId: input.entityId,
    creatorType: "CITIZEN",
    applicantType: "INDIVIDUAL",
    applicationType: serviceCode,
    examScheduleId: input.examScheduleId,
    temporaryBookingId: input.temporaryBookingId,
    licenseCategoryRequested: input.licenseCategory,
    provisionalLicenseNumber: input.provisionalLicenseNumber,
    examCenterName: input.examCenter,
    examFormat: input.examType || "PRACTICAL",
    examLanguage,
    nls: examLanguage,
    examScheduleDate: input.examScheduleDate,
    notificationPhone,
    notificationEmail,
    approvingOfficeLocationId,
    amount: Number(input.amount ?? process.env.IREMBO_APPLICATION_AMOUNT ?? 55000)
  };

  const payload = await withRetry(
    () =>
      postJson(
        createUrl,
        body,
        { "Content-Type": "application/json", NLS: examLanguage },
        createLabel,
        { useProfileSession: true }
      ),
    {
      label: createLabel,
      retryIf: (error) => !String(error.message).includes("423"),
      maxRetries: 2,
      timeoutMs: 15000
    }
  );

  if (payload?.status === true && payload.data?.applicationNumber) {
    return {
      applicationNumber: payload.data.applicationNumber,
      applicationState: payload.data.applicationState || "PAYMENT_PENDING",
      amount: body.amount,
      raw: payload.data
    };
  }

  const existingNumber = extractIremboApplicationNumber(payload?.message);
  if (existingNumber && isExistingApplicationMessage(payload?.message, payload?.responseCode)) {
    return {
      applicationNumber: existingNumber,
      applicationState: "PAYMENT_PENDING",
      amount: body.amount,
      raw: payload,
      alreadyExists: true
    };
  }

  assertSuccess(payload, createLabel);

  const data = payload.data || {};
  if (!data.applicationNumber) {
    throw new Error("Application number missing from create application response");
  }

  return {
    applicationNumber: data.applicationNumber,
    applicationState: data.applicationState || "PAYMENT_PENDING",
    amount: body.amount,
    raw: data
  };
}

export function buildExamScheduleDate(examDate, examTime) {
  const date = new Date(examDate);
  const [hours = "0", minutes = "0"] = String(examTime).split(":");
  date.setUTCHours(Number(hours), Number(minutes), 0, 0);
  return date.toISOString();
}

const PUBLIC_REQUEST_BASE =
  process.env.IREMBO_PUBLIC_REQUEST_BASE || `${BASE_URL.replace(/\/$/, "")}/request`;

function mapIremboPaymentStatus(paymentStatus) {
  const normalized = String(paymentStatus || "").trim().toUpperCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "PAYMENT_EXPIRED" || normalized === "EXPIRED") {
    return "PAYMENT_EXPIRED";
  }
  if (normalized === "PAYMENT_PENDING" || normalized === "PENDING") {
    return "PAYMENT_PENDING";
  }
  if (
    normalized === "PAYMENT_SUCCESSFUL" ||
    normalized === "PAYMENT_SUCCESS" ||
    normalized === "PAID" ||
    normalized === "SUCCESS" ||
    normalized === "COMPLETED"
  ) {
    return "PAID";
  }
  if (normalized === "PAYMENT_CANCELLED" || normalized === "CANCELLED") {
    return "PAYMENT_CANCELLED";
  }
  return normalized;
}

/**
 * Look up live payment/application validity on Irembo by application number.
 * Codes expire on Irembo — do not trust local PAYMENT_PENDING alone.
 */
export async function fetchPaymentTransactionByApplicationNumber(applicationNumber) {
  const number = String(applicationNumber || "").trim().toUpperCase();
  if (!number) {
    throw new Error("Application number is required.");
  }

  const payload = await getJson(
    `${PUBLIC_REQUEST_BASE}/find-payment-transaction/by-application-number`,
    {
      headers: {
        applicationNumber: number,
        Accept: "application/json"
      }
    },
    "fetchPaymentTransactionByApplicationNumber"
  );

  if (payload?.status === false || !payload?.data) {
    const message = String(payload?.message || "Application not found on Irembo").trim();
    const error = new Error(message);
    error.code = payload?.responseCode || "NOT_FOUND";
    throw error;
  }

  const data = payload.data;
  const paymentStatus = mapIremboPaymentStatus(data.paymentStatus);
  return {
    applicationNumber: data.applicationNumber || number,
    paymentStatus,
    iremboPaymentStatus: String(data.paymentStatus || "").trim().toUpperCase() || null,
    amount: data.price != null ? Number(data.price) : null,
    currencyCode: data.currencyCode || "RWF",
    billRefNumber: data.billRefNumber || null,
    paymentExpirationTime: data.paymentExpirationTime || null,
    creationTime: data.creationTime || null,
    serviceCode: data.serviceCode || null,
    state: data.state || null,
    active: data.active !== false,
    raw: data
  };
}
