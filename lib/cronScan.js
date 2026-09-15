import { getMonitoredCategories } from "../providers/iremboProvider.js";
import { SYSTEM_EXAM_LOCATION } from "./examCenters.js";

/** Scan only Kicukiro / BUSANZA AUTOMATED CENTER. */
export function getCronScanBatch() {
  const locations = [SYSTEM_EXAM_LOCATION];
  return {
    batchIndex: 0,
    batchCount: 1,
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
      concurrency: 2,
      maxPages: 8,
      limit: 50,
      allPages: false
    }
  };
}

export function getCronScanCategories() {
  return getMonitoredCategories();
}
