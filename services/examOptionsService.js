import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { examCentersMatch } from "../lib/examCenters.js";
import { scheduleMatchesLocationFilter } from "../lib/monitorPriority.js";
import { getStatus, listSchedules } from "./monitorService.js";
import { resolveScheduleTime } from "../lib/scheduleTime.js";

function formatDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function formatTimeKey(row) {
  return resolveScheduleTime(row);
}

function normalizeCenter(value) {
  return String(value || "").trim();
}

function matchesCenter(scheduleCenter, selectedCenter) {
  return examCentersMatch(scheduleCenter, selectedCenter);
}

export async function getExamFormOptions(filters = {}) {
  try {
    await ensureDatabaseSchema();
  } catch {
    // Non-fatal — reads still work when schema is already applied.
  }

  const category = filters.category ? String(filters.category).trim().toUpperCase() : "";
  const location = filters.location ? String(filters.location).trim() : "";
  const center = filters.center ? normalizeCenter(filters.center) : "";
  const date = filters.date ? String(filters.date).trim() : "";

  const schedules = await listSchedules({
    availableOnly: true,
    category: category || undefined,
    center: center || undefined,
    limit: 5000
  }).then((rows) =>
    location ? rows.filter((row) => scheduleMatchesLocationFilter(row, location)) : rows
  );

  const categories = [...new Set(schedules.map((row) => row.category).filter(Boolean))].sort();

  const categorySchedules = category
    ? schedules.filter((row) => String(row.category || "").toUpperCase() === category)
    : schedules;

  const centers = [...new Set(categorySchedules.map((row) => normalizeCenter(row.center)).filter(Boolean))].sort();

  const centerSchedules = categorySchedules.filter((row) => matchesCenter(row.center, center));

  const allTimes = new Map();
  for (const row of centerSchedules.length > 0 ? centerSchedules : categorySchedules) {
    const timeKey = formatTimeKey(row);
    if (!timeKey) {
      continue;
    }
    if (!allTimes.has(timeKey)) {
      allTimes.set(timeKey, { time: timeKey, slots: 0 });
    }
    allTimes.get(timeKey).slots += Number(row.remainingCapacity || 0);
  }
  const allAvailableTimes = [...allTimes.values()].sort((a, b) => a.time.localeCompare(b.time));

  const dateMap = new Map();
  for (const row of centerSchedules) {
    if (!row.startDateTime) {
      continue;
    }

    const dateKey = formatDateKey(row.startDateTime);
    if (!dateMap.has(dateKey)) {
      dateMap.set(dateKey, { date: dateKey, slots: 0, times: new Map() });
    }

    const dateEntry = dateMap.get(dateKey);
    dateEntry.slots += Number(row.remainingCapacity || 0);

    const timeKey = formatTimeKey(row);
    if (!timeKey) {
      continue;
    }
    if (!dateEntry.times.has(timeKey)) {
      dateEntry.times.set(timeKey, { time: timeKey, slots: 0 });
    }
    dateEntry.times.get(timeKey).slots += Number(row.remainingCapacity || 0);
  }

  const dates = [...dateMap.values()]
    .map((entry) => ({
      date: entry.date,
      slots: entry.slots,
      times: [...entry.times.values()].sort((a, b) => a.time.localeCompare(b.time))
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const selectedDate = dates.find((entry) => entry.date === date);
  const times = selectedDate?.times || (center ? allAvailableTimes : []);

  const status = await getStatus().catch(() => null);

  return {
    categories,
    centers,
    dates: dates.map(({ date: value, slots }) => ({ date: value, slots })),
    times,
    allTimes: allAvailableTimes,
    scheduleCount: schedules.length,
    lastScanAt: status?.lastScanAt || null
  };
}
