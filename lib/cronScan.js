import { getMonitoredCategories, getMonitoredLocations } from "../providers/iremboProvider.js";

const CRON_BATCH_SIZE = 7;
const CRON_INTERVAL_MS = 10 * 60 * 1000;
const PRIORITY_LOCATIONS = ["Kicukiro", "Busanza"];

function uniqueValues(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

/** Rotate districts so each 10-min cron finishes within Vercel's 300s limit. */
export function getCronScanBatch() {
  const all = getMonitoredLocations();
  const batchCount = Math.max(1, Math.ceil(all.length / CRON_BATCH_SIZE));
  const batchIndex = Math.floor(Date.now() / CRON_INTERVAL_MS) % batchCount;
  const start = batchIndex * CRON_BATCH_SIZE;
  const batch = all.slice(start, start + CRON_BATCH_SIZE);
  const locations = uniqueValues([...PRIORITY_LOCATIONS, ...batch]);

  return {
    batchIndex,
    batchCount,
    locations,
    locationCount: locations.length
  };
}

/** Scan options tuned for serverless cron (must complete under ~4 minutes). */
export function getCronScanOptions() {
  const batch = getCronScanBatch();
  return {
    ...batch,
    scanOptions: {
      locations: batch.locations,
      concurrency: 4,
      maxPages: 6,
      limit: 50,
      allPages: false
    }
  };
}

export function getCronScanCategories() {
  return getMonitoredCategories();
}
