import {
  BUSANZA_AUTOMATED_CENTER,
  examCentersMatch,
  KICUKIRO_BUSANZA_SITE,
  normalizeCenterName
} from "./examCenters.js";

const CENTER_EXPECTED_LOCATIONS = {
  [KICUKIRO_BUSANZA_SITE.toLowerCase()]: "kicukiro",
  // Irembo lists this site under the Kicukiro district API, not a separate Busanza district.
  [BUSANZA_AUTOMATED_CENTER.toLowerCase()]: "kicukiro"
};

export function getIremboScanDistrictForCenter(center) {
  const name = normalizeCenterName(center).toLowerCase();
  if (
    name === BUSANZA_AUTOMATED_CENTER.toLowerCase() ||
    name === KICUKIRO_BUSANZA_SITE.toLowerCase()
  ) {
    return "Kicukiro";
  }
  return "";
}

export function getMonitorPriorityConfig(overrides = {}) {
  return {
    category: String(overrides.category || process.env.PRIORITY_CATEGORY || "A")
      .trim()
      .toUpperCase(),
    center: String(overrides.center || process.env.PRIORITY_CENTER || BUSANZA_AUTOMATED_CENTER).trim(),
    location: String(overrides.location || process.env.PRIORITY_LOCATION || "Kicukiro").trim()
  };
}

export function resolveScheduleLocation(center, fallbackLocation = "") {
  const name = normalizeCenterName(center).toLowerCase();
  if (name === KICUKIRO_BUSANZA_SITE.toLowerCase()) {
    return "Kicukiro";
  }
  if (name === BUSANZA_AUTOMATED_CENTER.toLowerCase()) {
    return "Kicukiro";
  }
  return String(fallbackLocation || "").trim();
}

export function canonicalizeSchedule(schedule) {
  if (!schedule) {
    return schedule;
  }
  const center = normalizeCenterName(schedule.center);
  const location = resolveScheduleLocation(center, schedule.location);
  if (center === schedule.center && location === schedule.location) {
    return schedule;
  }
  return { ...schedule, center, location };
}

export function scheduleMatchesLocationFilter(schedule, locationFilter) {
  if (!locationFilter || locationFilter === "all") {
    return true;
  }
  const canonical = canonicalizeSchedule(schedule);
  return String(canonical.location || "").trim() === String(locationFilter).trim();
}

export function scheduleMatchesCategoryFilter(schedule, categoryFilter) {
  if (!categoryFilter || categoryFilter === "all") {
    return true;
  }
  return String(schedule.category || "").trim().toUpperCase() === String(categoryFilter).trim().toUpperCase();
}

export function centerMatchesScanLocation(center, scanLocation) {
  const location = String(scanLocation || "").trim().toLowerCase();
  const name = normalizeCenterName(center).toLowerCase();
  if (!location || !name) {
    return true;
  }
  const expected = CENTER_EXPECTED_LOCATIONS[name];
  if (expected) {
    return location === expected;
  }
  return name.includes(location) || location.includes(name.split(/[\s-]+/)[0]);
}

export function isCenterLocationValid(schedule) {
  const center = normalizeCenterName(schedule?.center).toLowerCase();
  const location = String(schedule?.location || "").trim().toLowerCase();
  const expected = CENTER_EXPECTED_LOCATIONS[center];
  if (!expected) {
    return true;
  }
  return location === expected;
}

export function matchesPrioritySchedule(schedule, priority = getMonitorPriorityConfig()) {
  if (!schedule || Number(schedule.remainingCapacity || 0) <= 0) {
    return false;
  }
  if (!examCentersMatch(schedule.center, priority.center)) {
    return false;
  }
  const normalized = canonicalizeSchedule(schedule);
  const centerKey = normalizeCenterName(priority.center).toLowerCase();
  const expectedLocation = CENTER_EXPECTED_LOCATIONS[centerKey];
  const scheduleLocation = String(normalized.location || "").trim().toLowerCase();
  if (expectedLocation) {
    return scheduleLocation === expectedLocation;
  }
  const wantLocation = String(priority.location || "").trim().toLowerCase();
  if (!wantLocation) {
    return true;
  }
  return scheduleLocation === wantLocation;
}

export function matchesPriorityCategorySchedule(schedule, priority = getMonitorPriorityConfig()) {
  return (
    matchesPrioritySchedule(schedule, priority) &&
    String(schedule.category || "").toUpperCase() === priority.category
  );
}

export function isDetectedSchedule(schedule) {
  if (!schedule || Number(schedule.remainingCapacity || 0) <= 0) {
    return false;
  }
  return isCenterLocationValid(canonicalizeSchedule(schedule));
}

export function matchesSiteFilter(schedule, siteFilter) {
  if (!siteFilter || siteFilter === "all") {
    return true;
  }
  return examCentersMatch(schedule.center, siteFilter);
}

export function formatPriorityCenterLabel(priority = getMonitorPriorityConfig()) {
  return normalizeCenterName(priority.center);
}
