export const BUSANZA_AUTOMATED_CENTER = "BUSANZA AUTOMATED CENTER";
export const KICUKIRO_BUSANZA_SITE = "KICUKIRO - BUSANZA SITE (KIC)";

export function normalizeCenterName(center) {
  return String(center || "").trim();
}

export function formatExamCenterLabel(center) {
  return normalizeCenterName(center);
}

function centerKey(center) {
  return normalizeCenterName(center).toLowerCase();
}

/** Stable key for cache/dedupe — one key per exact center name. */
export function centerAliasKey(center) {
  return centerKey(center);
}

export function centerAliasKeys(center) {
  const key = centerKey(center);
  return key ? [key] : [];
}

/** Exact center match (case-insensitive). KIC and BUSANZA AUTOMATED CENTER are different sites. */
export function examCentersMatch(scheduleCenter, selectedCenter) {
  const selected = centerKey(selectedCenter);
  if (!selected) {
    return true;
  }
  const center = centerKey(scheduleCenter);
  if (!center) {
    return false;
  }
  return center === selected;
}

/** Keep the center name as returned by Irembo — do not merge distinct sites. */
export function preferCanonicalCenter(center) {
  return normalizeCenterName(center);
}

export function centerSearchTerms(center) {
  const raw = normalizeCenterName(center);
  return raw ? [raw] : [];
}

export function buildSlotCacheKey(category, center = "") {
  const normalizedCategory = String(category || "").trim().toUpperCase();
  const normalizedCenter = center ? centerKey(center) : "";
  return [normalizedCategory, normalizedCenter].filter(Boolean).join("|");
}

export function dedupeExamSites(sites, slotBackedCenters = new Set()) {
  const seen = new Map();
  for (const site of sites) {
    const key = centerKey(site.center);
    if (!key) {
      continue;
    }
    const existing = seen.get(key);
    const hasSlots = slotBackedCenters.has(key);
    const existingHasSlots = existing && slotBackedCenters.has(centerKey(existing.center));
    const center = normalizeCenterName(site.center);
    if (!existing || (hasSlots && !existingHasSlots)) {
      seen.set(key, {
        ...site,
        center
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.center.localeCompare(b.center));
}
