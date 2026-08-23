import axios from "axios";
import { prisma } from "../lib/db.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { bootstrapProfileSession, buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { getMonitoredLocations, queryPoliceRequest } from "../providers/iremboProvider.js";
import { logger } from "../lib/logger.js";

const IREMBO_PUBLIC = process.env.IREMBO_BASE_URL || "https://irembo.gov.rw/irembo/rest/public";
const APPLICATION_CODE =
  process.env.IREMBO_DDL_APPLICATION_CODE || "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";
const SITE_CACHE_MS = Number(process.env.EXAM_SITES_CACHE_MS || 900_000);
const siteCache = new Map();

const BUILTIN_EXAM_SITES = [
  { center: "BUSANZA AUTOMATED CENTER", location: "Kicukiro" },
  { center: "KICUKIRO - BUSANZA SITE (KIC)", location: "Kicukiro" },
  { center: "MUSANZE SITE (MUS)", location: "Musanze" },
  { center: "NYAMAGABE SITE", location: "Nyamagabe" },
  { center: "KICUKIRO SITE", location: "Kicukiro" },
  { center: "GASABO SITE", location: "Gasabo" },
  { center: "NYARUGENGE SITE", location: "Nyarugenge" }
];

function normalizeCenter(value) {
  return String(value || "").trim();
}

function siteKey(location, center) {
  return `${String(location || "").trim().toLowerCase()}::${normalizeCenter(center).toLowerCase()}`;
}

function mergeSites(target, sites) {
  for (const site of sites) {
    const center = normalizeCenter(site.center);
    const location = String(site.location || "").trim();
    if (!center || !location) {
      continue;
    }
    target.set(siteKey(location, center), { center, location });
  }
}

function parseKnownSitesFromEnv() {
  const raw = process.env.IREMBO_KNOWN_EXAM_SITES?.trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) =>
          typeof entry === "string"
            ? (() => {
                const [center, location] = entry.split("|").map((part) => part.trim());
                return center && location ? { center, location } : null;
              })()
            : entry?.center && entry?.location
              ? { center: entry.center, location: entry.location }
              : null
        )
        .filter(Boolean);
    }
  } catch {
    // Fall through to pipe-separated pairs.
  }

  return raw
    .split(",")
    .map((entry) => {
      const [center, location] = entry.split("|").map((part) => part.trim());
      return center && location ? { center, location } : null;
    })
    .filter(Boolean);
}

async function fetchIremboDistricts(headers) {
  const response = await axios.get(`${IREMBO_PUBLIC}/location/district`, {
    headers,
    timeout: Number(process.env.IREMBO_REQUEST_TIMEOUT_MS || 15000),
    validateStatus: (status) => status >= 200 && status < 500
  });
  if (response.status >= 400) {
    throw new Error(`Irembo districts API returned HTTP ${response.status}`);
  }
  return response.data?.data || [];
}

async function fetchIremboOfficesForDistrict(headers, district) {
  const response = await axios.get(`${IREMBO_PUBLIC}/office/`, {
    headers: {
      ...headers,
      applicationCode: APPLICATION_CODE,
      locationId: district.guid
    },
    timeout: Number(process.env.IREMBO_REQUEST_TIMEOUT_MS || 15000),
    validateStatus: (status) => status >= 200 && status < 500
  });
  if (response.status >= 400) {
    return [];
  }
  return response.data?.data || [];
}

async function fetchIremboDrivingTestOffices() {
  await bootstrapProfileSession(false);
  const headers = await buildProfileRequestHeaders({});
  const districts = await fetchIremboDistricts(headers);
  const siteMap = new Map();
  const concurrency = 8;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < districts.length) {
      const district = districts[nextIndex];
      nextIndex += 1;
      const districtName = String(district?.name || "").trim();
      if (!district?.guid || !districtName) {
        continue;
      }
      try {
        const offices = await fetchIremboOfficesForDistrict(headers, district);
        mergeSites(
          siteMap,
          offices.map((office) => ({
            center: office.name || office.code || office.description,
            location: districtName || office.location?.name
          }))
        );
      } catch (error) {
        logger.warn("Could not load Irembo offices for district", {
          district: districtName,
          message: error.message
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(districts.length, 1)) }, worker));
  return [...siteMap.values()];
}

async function fetchIremboTestCenters(category) {
  const locations = getMonitoredLocations();
  const selectedDate = new Date().toISOString().slice(0, 10);
  const headers = { category };
  const siteMap = new Map();
  const concurrency = 6;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < locations.length) {
      const location = locations[nextIndex];
      nextIndex += 1;
      try {
        const centers = (await queryPoliceRequest("test-centers", { selectedDate }, { ...headers, location })) || [];
        mergeSites(
          siteMap,
          centers.filter(Boolean).map((center) => ({ center, location }))
        );
      } catch {
        // Some districts may not expose test centers for this category/date.
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, locations.length) }, worker));
  return [...siteMap.values()];
}

async function fetchDbExamSites(category) {
  const where = {
    AND: [{ center: { not: null } }, { NOT: { center: "" } }, { location: { not: null } }, { NOT: { location: "" } }]
  };
  if (category) {
    where.category = category;
  }

  const rows = await prisma.schedule.groupBy({
    by: ["center", "location"],
    where
  });

  return rows.map((row) => ({ center: row.center, location: row.location }));
}

export async function getExamSitesForCategory(category = "", options = {}) {
  const includeOffices =
    options.includeOffices === true || process.env.EXAM_SITES_INCLUDE_OFFICES === "true";
  const normalizedCategory = String(category || "").trim().toUpperCase();
  const cacheKey = `${normalizedCategory || "__all__"}::${includeOffices ? "full" : "light"}`;
  const cached = siteCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SITE_CACHE_MS) {
    return cached.payload;
  }

  const siteMap = new Map();
  const sources = [];

  mergeSites(siteMap, parseKnownSitesFromEnv());
  mergeSites(siteMap, BUILTIN_EXAM_SITES);
  if (siteMap.size > 0) {
    sources.push("fallback");
  }

  const tasks = [
    ensureDatabaseSchema()
      .then(() => fetchDbExamSites(normalizedCategory))
      .then((sites) => ({ source: "db", sites }))
      .catch((error) => {
        logger.warn("DB exam site list failed", { message: error.message });
        return { source: "db", sites: [] };
      })
  ];

  if (normalizedCategory) {
    tasks.push(
      fetchIremboTestCenters(normalizedCategory)
        .then((sites) => ({ source: "irembo-test-centers", sites }))
        .catch((error) => {
          logger.warn("Irembo test-center site list failed", {
            category: normalizedCategory,
            message: error.message
          });
          return { source: "irembo-test-centers", sites: [] };
        })
    );
  }

  if (includeOffices) {
    tasks.push(
      fetchIremboDrivingTestOffices()
        .then((sites) => ({ source: "irembo-offices", sites }))
        .catch((error) => {
          logger.warn("Irembo office site list failed", { message: error.message });
          return { source: "irembo-offices", sites: [] };
        })
    );
  }

  const results = await Promise.all(tasks);
  for (const { source, sites } of results) {
    const before = siteMap.size;
    mergeSites(siteMap, sites);
    if (siteMap.size > before) {
      sources.push(source);
    }
  }

  const sites = [...siteMap.values()].sort(
    (a, b) => a.center.localeCompare(b.center) || a.location.localeCompare(b.location)
  );
  const payload = {
    sites,
    source: sources.length > 0 ? sources.join("+") : "none",
    light: !includeOffices
  };
  siteCache.set(cacheKey, { at: Date.now(), payload });
  return payload;
}
