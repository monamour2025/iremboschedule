import axios from "axios";
import { getRuntimeIremboCookie } from "../lib/iremboBrowserSession.js";
import { applyIremboResponseCookies, mergeCookieString, warmIremboSession } from "../lib/iremboSession.js";
import crypto from "node:crypto";
import { logger } from "../lib/logger.js";
import { extractBookableScheduleId, extractGuidFromRow } from "../lib/scheduleIds.js";
import { parseTimeRange, resolveRowStartDateTime, formatScheduleTimeLocal } from "../lib/scheduleTime.js";
import { centerMatchesScanLocation, getIremboScanDistrictForCenter, getMonitorPriorityConfig, isCenterLocationValid, resolveScheduleLocation } from "../lib/monitorPriority.js";
import { examCentersMatch, preferCanonicalCenter, centerSearchTerms } from "../lib/examCenters.js";

const IREMBO_API_BASE =
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request";
const IREMBO_API_URL = `${IREMBO_API_BASE}/all-schedules`;

let sessionCookie = "";
let encryptionKeys = null;

export function getEncryptionKeys() {
  if (encryptionKeys) {
    return encryptionKeys;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });

  encryptionKeys = {
    publicKeyB64: publicKey.toString("base64"),
    privateKey: crypto.createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" })
  };

  return encryptionKeys;
}

function decryptResponseData(encryptedData, privateKey) {
  const [encryptedSecret, encryptedPayload] = encryptedData.split("#");
  const secretBuffer = crypto.privateDecrypt(
    { key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(encryptedSecret, "base64")
  );
  const secretKey = JSON.parse(secretBuffer.toString("utf8"));
  const combined = Buffer.from(encryptedPayload, "base64");
  const iv = combined.subarray(0, 16);
  const ciphertext = combined.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", Buffer.from(secretKey, "utf8"), iv);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

const DEFAULT_LOCATIONS = [
  "Bugesera",
  "Burera",
  "Gakenke",
  "Gasabo",
  "Gatsibo",
  "Gicumbi",
  "Gisagara",
  "Huye",
  "Kamonyi",
  "Karongi",
  "Kayonza",
  "Kicukiro",
  "Busanza",
  "Kirehe",
  "Muhanga",
  "Musanze",
  "Ngoma",
  "Ngororero",
  "Nyabihu",
  "Nyagatare",
  "Nyamagabe",
  "Nyamasheke",
  "Nyanza",
  "Nyarugenge",
  "Nyaruguru",
  "Rubavu",
  "Ruhango",
  "Rulindo",
  "Rusizi",
  "Rutsiro",
  "Rwamagana"
];

const DEFAULT_CATEGORIES = ["A", "A1", "B", "B1", "C", "D", "D1", "E", "F"];

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

export function getMonitoredLocations(options = {}) {
  if (options.location) {
    return uniqueValues([options.location]);
  }

  if (Array.isArray(options.locations) && options.locations.length > 0) {
    return withPriorityLocation(uniqueValues(options.locations));
  }

  if (process.env.IREMBO_LOCATIONS?.trim()) {
    return withPriorityLocation(uniqueValues(process.env.IREMBO_LOCATIONS.split(",")));
  }

  return withPriorityLocation(DEFAULT_LOCATIONS);
}

function withPriorityLocation(locations) {
  const priority = getMonitorPriorityConfig();
  const scanDistrict = getIremboScanDistrictForCenter(priority.center) || priority.location;
  return uniqueValues([...locations, scanDistrict].filter(Boolean));
}

export function getMonitoredCategories(options = {}) {
  if (options.category) {
    return uniqueValues([options.category]);
  }

  if (Array.isArray(options.categories) && options.categories.length > 0) {
    return uniqueValues(options.categories);
  }

  if (process.env.IREMBO_CATEGORIES?.trim()) {
    return withPriorityCategory(uniqueValues(process.env.IREMBO_CATEGORIES.split(",")));
  }

  return withPriorityCategory(DEFAULT_CATEGORIES);
}

function withPriorityCategory(categories) {
  const priority = getMonitorPriorityConfig();
  return uniqueValues([...categories, priority.category].filter(Boolean));
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return null;
}

function asInteger(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickRows(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.schedules)) {
    return payload.schedules;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.data?.schedules)) {
    return payload.data.schedules;
  }
  if (Array.isArray(payload?.data?.content)) {
    return payload.data.content;
  }
  if (Array.isArray(payload?.data?.items)) {
    return payload.data.items;
  }
  if (Array.isArray(payload?.content)) {
    return payload.content;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

function buildScheduleId({ category, rawScheduleId, fallbackScheduleId, startDateTime, timeLabel }) {
  const base = rawScheduleId ? `${category}:${rawScheduleId}` : fallbackScheduleId;
  const timeKey = timeLabel || (startDateTime ? formatScheduleTimeLocal(startDateTime) : "");
  if (!timeKey || !base) {
    return base;
  }
  if (base.includes(`@${timeKey}`)) {
    return base;
  }
  return `${base}@${timeKey}`;
}

function normalizeSchedule(row, sourceLocation, sourceCategory, hints = {}) {
  const bookableId = extractBookableScheduleId(row);
  const guid = bookableId || extractGuidFromRow(row);
  const rawScheduleId = guid
    ? guid
    : String(firstValue(row, ["scheduleId", "id", "code", "scheduleCode", "slotId"]) || "").trim();
  const rowCenter = firstValue(row, ["center", "testCenter", "examCenter", "drivingTestCenter", "site"]);
  const center = preferCanonicalCenter(hints.testCenter || rowCenter);
  const location =
    resolveScheduleLocation(
      center,
      firstValue(row, ["locationName", "location", "district", "place"]) || sourceLocation
    ) || sourceLocation;
  const category = firstValue(row, ["categoryOrLane", "category", "licenseCategory"]) || sourceCategory;
  const startDateTime = resolveRowStartDateTime(row, hints);
  const timeLabel = hints.startTime || firstValue(row, ["startTime", "time", "examTime"]);
  const fallbackScheduleId = [category, location, center, startDateTime?.toISOString(), timeLabel]
    .filter(Boolean)
    .join(":");

  return {
    scheduleId: buildScheduleId({
      category,
      rawScheduleId,
      fallbackScheduleId,
      startDateTime,
      timeLabel
    }),
    iremboScheduleGuid: guid || null,
    center,
    location,
    category,
    startDateTime,
    endDateTime: asDate(firstValue(row, ["endDateTime", "endTime", "endDate"])),
    remainingCapacity: asInteger(
      firstValue(row, ["remainingCapacity", "remainingSlots", "availableSlots", "availablePlaces"])
    ),
    maximumCapacity: asInteger(
      firstValue(row, ["maximumCapacity", "maxCapacity", "totalSlots", "capacity"])
    )
  };
}

function keepNormalizedSchedule(schedule, scanLocation) {
  if (!schedule?.scheduleId || !isCenterLocationValid(schedule)) {
    return false;
  }
  const scan = String(scanLocation || "").trim().toLowerCase();
  const resolved = String(schedule.location || "").trim().toLowerCase();
  if (!scan || !resolved) {
    return true;
  }
  return scan === resolved;
}

function scheduleDedupeKey(schedule) {
  return `${schedule.scheduleId}|${schedule.startDateTime?.toISOString() || ""}`;
}

function updateCookie(headers) {
  const cookies = headers?.["set-cookie"];
  if (!Array.isArray(cookies) || cookies.length === 0) {
    return;
  }
  sessionCookie = cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function publicErrorPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    status: payload.status,
    responseCode: payload.responseCode,
    message: payload.message,
    error: payload.error
  };
}

function defaultRequestHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://irembo.gov.rw",
    Referer: "https://irembo.gov.rw/home/citizen/all_services",
    "User-Agent":
      process.env.IREMBO_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  };
}

function assertSuccessfulPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Irembo API returned an empty response");
  }

  if (payload.status === false) {
    const message = String(payload.message || "Irembo API request failed").trim();
    throw new Error(
      `Irembo API rejected the request (${payload.responseCode || "UNKNOWN"}): ${message}`
    );
  }
}

let sessionBootstrapped = false;

async function ensureSession() {
  await warmIremboSession(false);
  sessionBootstrapped = true;
}

export async function getIremboSessionHeaders() {
  await ensureSession();
  const cookie = mergeCookieString(getRuntimeIremboCookie() || sessionCookie);
  return {
    ...defaultRequestHeaders(),
    ...(cookie ? { Cookie: cookie } : {})
  };
}

export function captureIremboResponseCookies(headers) {
  updateCookie(headers);
  applyIremboResponseCookies(headers);
}

function unwrapPayload(payload) {
  assertSuccessfulPayload(payload);

  if (payload.responseEncrypted && typeof payload.data === "string") {
    return decryptResponseData(payload.data, getEncryptionKeys().privateKey);
  }

  return payload.data ?? payload;
}

async function requestWithRetry(params, requestHeaders, attempt = 1, endpoint = "all-schedules", options = {}) {
  const timeoutMs = Number(
    options.timeoutMs ?? requestHeaders?.timeoutMs ?? process.env.IREMBO_REQUEST_TIMEOUT_MS ?? 8000
  );
  const maxAttempts = Number(options.maxAttempts ?? 3);
  try {
    await ensureSession();
    const keys = getEncryptionKeys();
    const { timeoutMs: _ignored, ...headersForRequest } = requestHeaders || {};

    const response = await axios.get(`${IREMBO_API_BASE}/${endpoint}`, {
      params,
      timeout: timeoutMs,
      headers: {
        ...defaultRequestHeaders(),
        ...headersForRequest,
        RPK: keys.publicKeyB64,
        ...(sessionCookie ? { Cookie: sessionCookie } : {})
      },
      validateStatus: (status) => status >= 200 && status < 500
    });

    updateCookie(response.headers);

    if (response.status >= 400) {
      const publicError = publicErrorPayload(response.data);
      throw new Error(
        `Irembo API returned HTTP ${response.status}${
          publicError?.message ? `: ${publicError.message}` : ""
        }`
      );
    }

    return unwrapPayload(response.data);
  } catch (error) {
    if (attempt >= maxAttempts) {
      throw error;
    }
    const delayMs = 500 * attempt;
    logger.warn("Irembo request failed; retrying", {
      attempt,
      delayMs,
      message: error.message
    });
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return requestWithRetry(params, requestHeaders, attempt + 1, endpoint, options);
  }
}

export async function queryPoliceRequest(endpoint, params = {}, extraHeaders = {}, options = {}) {
  const baseHeaders = {
    service: process.env.IREMBO_SERVICE || "PRACTICAL_EXAM",
    beneficiaries: process.env.IREMBO_BENEFICIARIES || "PrivateCandidate",
    ...extraHeaders
  };
  return requestWithRetry(params, baseHeaders, 1, endpoint, options);
}

function uniqueScheduleDates(rows) {
  const dates = new Set();
  for (const { row } of rows) {
    const startDateTime = resolveRowStartDateTime(row);
    if (startDateTime) {
      dates.add(startDateTime.toISOString().slice(0, 10));
      continue;
    }
    const datePart = firstValue(row, ["scheduleDate", "selectedDate", "startDate", "date", "examDate"]);
    if (datePart) {
      const parsed = new Date(datePart);
      if (!Number.isNaN(parsed.getTime())) {
        dates.add(parsed.toISOString().slice(0, 10));
      }
    }
  }
  return [...dates].sort();
}

async function expandSchedulesByTimeRanges(category, location, locationRows) {
  const expandTimes = process.env.IREMBO_EXPAND_TIME_SLOTS !== "false";
  if (!expandTimes || locationRows.length === 0) {
    return locationRows
      .map(({ row, sourceLocation, sourceCategory }) =>
        normalizeSchedule(row, sourceLocation, sourceCategory)
      )
      .filter((schedule) => keepNormalizedSchedule(schedule, location));
  }

  const schedules = [];
  const seen = new Set();
  const headers = { category, location };

  const dates = uniqueScheduleDates(locationRows);
  for (const selectedDate of dates) {
    try {
      const timeRanges =
        (await queryPoliceRequest("time-ranges", { selectedDate }, headers)) || [];
      const centers = (await queryPoliceRequest("test-centers", { selectedDate }, headers)) || [];

      for (const range of timeRanges) {
        const { startTime, endTime } = parseTimeRange(range);
        for (const testCenter of centers.filter(Boolean)) {
          if (!centerMatchesScanLocation(testCenter, location)) {
            continue;
          }
          const rows = await queryFilteredSchedules({
            category,
            location,
            page: 1,
            limit: 20,
            selectedDate,
            startTime,
            endTime,
            testCenter
          });

          for (const row of rows) {
            const rowCategory = firstValue(row, ["categoryOrLane", "category", "licenseCategory"]);
            if (rowCategory && String(rowCategory).toUpperCase() !== String(category).toUpperCase()) {
              continue;
            }
            const rowCenter = firstValue(row, [
              "center",
              "testCenter",
              "examCenter",
              "drivingTestCenter",
              "site"
            ]);
            if (testCenter && rowCenter && !examCentersMatch(rowCenter, testCenter)) {
              continue;
            }
            const remainingCapacity = asInteger(
              firstValue(row, ["remainingCapacity", "remainingSlots", "availableSlots", "availablePlaces"])
            );
            if (remainingCapacity !== null && remainingCapacity <= 0) {
              continue;
            }
            const schedule = normalizeSchedule(row, location, category, {
              selectedDate,
              startTime,
              testCenter: testCenter || rowCenter
            });
            const dedupeKey = scheduleDedupeKey(schedule);
            if (!schedule.scheduleId || seen.has(dedupeKey)) {
              continue;
            }
            if (!keepNormalizedSchedule(schedule, location)) {
              continue;
            }
            seen.add(dedupeKey);
            schedules.push(schedule);
          }
        }
      }
    } catch (error) {
      logger.warn("Could not expand schedule times for location", {
        category,
        location,
        selectedDate,
        message: error.message
      });
    }
  }

  if (schedules.length === 0) {
    for (const { row, sourceLocation, sourceCategory } of locationRows) {
      const schedule = normalizeSchedule(row, sourceLocation, sourceCategory);
      const dedupeKey = scheduleDedupeKey(schedule);
      if (!schedule.scheduleId || seen.has(dedupeKey)) {
        continue;
      }
      if (!keepNormalizedSchedule(schedule, location)) {
        continue;
      }
      seen.add(dedupeKey);
      schedules.push(schedule);
    }
  }

  return schedules;
}

async function appendPriorityCenterSchedules(schedulesById, categories) {
  const priority = getMonitorPriorityConfig();
  const location = getIremboScanDistrictForCenter(priority.center) || priority.location;
  const selectedDate = new Date().toISOString().slice(0, 10);

  for (const category of categories) {
    for (const testCenter of centerSearchTerms(priority.center)) {
      try {
        const rows = await queryFilteredSchedules({
          category,
          location,
          page: 1,
          limit: 50,
          selectedDate,
          testCenter
        });

        for (const row of rows) {
          const remainingCapacity = asInteger(
            firstValue(row, ["remainingCapacity", "remainingSlots", "availableSlots", "availablePlaces"])
          );
          if (remainingCapacity !== null && remainingCapacity <= 0) {
            continue;
          }
          const schedule = normalizeSchedule(row, location, category, {
            selectedDate,
            testCenter: preferCanonicalCenter(testCenter)
          });
          if (schedule.scheduleId && keepNormalizedSchedule(schedule, location)) {
            schedulesById.set(schedule.scheduleId, schedule);
          }
        }
      } catch (error) {
        logger.warn("Priority center scan failed", {
          category,
          testCenter,
          message: error.message
        });
      }
    }
  }
}

export async function fetchSchedules(options = {}) {
  const firstPage = options.page || 1;
  const limit = options.limit || Number(process.env.IREMBO_PAGE_LIMIT || 50);
  const maxPages = options.maxPages || Number(process.env.IREMBO_MAX_PAGES || 20);
  const concurrency = Number(options.concurrency || process.env.IREMBO_LOCATION_CONCURRENCY || 10);
  const locations = getMonitoredLocations(options);
  const categories = getMonitoredCategories(options);
  const baseHeaders = {
    service: options.service || process.env.IREMBO_SERVICE || "PRACTICAL_EXAM",
    beneficiaries:
      options.beneficiaries || process.env.IREMBO_BENEFICIARIES || "PrivateCandidate"
  };
  const baseParams = {
    limit
  };
  const scannedLocations = [];
  const failedLocations = [];
  const scannedScopes = [];
  const failedScopes = [];
  const scanTargets = categories.flatMap((category) =>
    locations.map((location) => ({ category, location }))
  );

  const locationResults = await mapWithConcurrency(scanTargets, concurrency, async ({ category, location }) => {
    const locationRows = [];
    let page = firstPage;

    try {
      while (true) {
        const payload = await requestWithRetry(
          { ...baseParams, page },
          { ...baseHeaders, category, location }
        );
        const rows = pickRows(payload);
        locationRows.push(...rows.map((row) => ({ row, sourceLocation: location, sourceCategory: category })));

        if (options.allPages === false || rows.length < limit || page - firstPage + 1 >= maxPages) {
          break;
        }

        page += 1;
      }
      scannedLocations.push(location);
      scannedScopes.push({ category, location });
    } catch (error) {
      failedLocations.push(location);
      failedScopes.push({ category, location });
      logger.error("Irembo location scan failed", {
        category,
        location,
        message: error.message
      });
    }

    return { category, location, locationRows };
  });

  const schedulesById = new Map();

  for (const { category, location, locationRows } of locationResults) {
    const expanded = await expandSchedulesByTimeRanges(category, location, locationRows);
    for (const schedule of expanded.filter((row) => row.scheduleId)) {
      schedulesById.set(schedule.scheduleId, schedule);
    }
  }

  await appendPriorityCenterSchedules(schedulesById, categories);

  const schedules = [...schedulesById.values()];
  schedules.scanMeta = {
    scannedLocations: uniqueValues(scannedLocations),
    failedLocations: uniqueValues(failedLocations),
    scannedScopes,
    failedScopes,
    categories
  };

  return schedules;
}

export async function queryFilteredSchedules({
  category,
  location,
  page = 1,
  limit = 50,
  selectedDate,
  startTime,
  endTime,
  testCenter
}) {
  const { buildProfileRequestHeaders } = await import("../lib/iremboProfileSession.js");
  const params = {
    page,
    limit,
    ...(selectedDate ? { selectedDate } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(testCenter ? { testCenter } : {})
  };
  const profileHeaders = await buildProfileRequestHeaders({
    service: process.env.IREMBO_SERVICE || "PRACTICAL_EXAM",
    beneficiaries: process.env.IREMBO_BENEFICIARIES || "PrivateCandidate",
    category,
    location,
    ...(selectedDate ? { scheduleDate: selectedDate } : {})
  });

  await ensureSession();
  const keys = getEncryptionKeys();
  const cookie = mergeCookieString(getRuntimeIremboCookie() || sessionCookie);

  const response = await axios.get(`${IREMBO_API_BASE}/schedules`, {
    params,
    timeout: Number(process.env.IREMBO_REQUEST_TIMEOUT_MS || 15000),
    headers: {
      ...profileHeaders,
      RPK: keys.publicKeyB64,
      ...(cookie ? { Cookie: cookie } : {})
    },
    validateStatus: (status) => status >= 200 && status < 500
  });

  updateCookie(response.headers);

  if (response.status >= 400) {
    const publicError = publicErrorPayload(response.data);
    throw new Error(
      `Irembo schedules API returned HTTP ${response.status}${
        publicError?.message ? `: ${publicError.message}` : ""
      }`
    );
  }

  return pickRows(unwrapPayload(response.data));
}
