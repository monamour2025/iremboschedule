export const IREMBO_TIMEZONE = process.env.IREMBO_TIMEZONE || "Africa/Kigali";

export function formatScheduleTimeLocal(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IREMBO_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

export function formatScheduleDateLocal(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IREMBO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

export function parseIremboLocalDateTime(datePart, timePart) {
  const date = String(datePart || "").trim().slice(0, 10);
  const time = String(timePart || "").trim().slice(0, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00+02:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asDate(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null && source[key] !== "") {
      return source[key];
    }
  }
  return null;
}

export function resolveRowStartDateTime(row, hints = {}) {
  const direct = asDate(firstValue(row, ["startDateTime"]));
  if (direct) {
    return direct;
  }

  const datePart =
    hints.selectedDate ||
    firstValue(row, ["scheduleDate", "selectedDate", "startDate", "date", "examDate"]);
  const timePart =
    hints.startTime ||
    firstValue(row, ["startTime", "time", "examTime", "slotTime", "scheduleTime"]);

  if (datePart && timePart) {
    const dateString = String(datePart).trim();
    const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
      ? dateString
      : asDate(datePart)?.toISOString().slice(0, 10);
    const combined = parseIremboLocalDateTime(normalizedDate, timePart);
    if (combined) {
      return combined;
    }
  }

  const dateOnly = asDate(datePart || firstValue(row, ["startDate", "date"]));
  if (dateOnly && hints.startTime) {
    return parseIremboLocalDateTime(dateOnly.toISOString().slice(0, 10), hints.startTime);
  }

  return dateOnly;
}

export function parseTimeRange(range) {
  const [startTime = "08:00", endTime = "09:00"] = String(range).split("-").map((part) => part.trim());
  return { startTime, endTime };
}

export function normalizeExamTimeInput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return "";
  }
  const hours = String(Number(match[1])).padStart(2, "0");
  return `${hours}:${match[2]}`;
}

export function extractTimeFromScheduleId(scheduleId) {
  const value = String(scheduleId || "").trim();
  const at = value.lastIndexOf("@");
  if (at === -1) {
    return "";
  }
  return normalizeExamTimeInput(value.slice(at + 1));
}

export function resolveScheduleTime(schedule) {
  if (!schedule) {
    return "";
  }
  if (schedule.startDateTime) {
    return formatScheduleTimeLocal(schedule.startDateTime);
  }
  return extractTimeFromScheduleId(schedule.scheduleId);
}

export function resolveScheduleCategory(schedule) {
  const fromField = String(schedule?.category || "").trim().toUpperCase();
  if (fromField) {
    return fromField;
  }
  const prefix = String(schedule?.scheduleId || "").split(":")[0]?.trim().toUpperCase();
  return prefix || "";
}

export function scheduleMatchesCategory(schedule, category) {
  const want = String(category || "").trim().toUpperCase();
  if (!want) {
    return false;
  }
  return resolveScheduleCategory(schedule) === want;
}

export function examTimeToMinutes(value) {
  const normalized = normalizeExamTimeInput(value);
  if (!normalized) {
    return null;
  }
  const [hours = 0, minutes = 0] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

export function scheduleTimeDistanceMinutes(startDateTime, preferredExamTime) {
  const preferredMinutes = examTimeToMinutes(preferredExamTime);
  if (preferredMinutes === null || !startDateTime) {
    return Number.MAX_SAFE_INTEGER;
  }
  const scheduleMinutes = examTimeToMinutes(formatScheduleTimeLocal(startDateTime));
  if (scheduleMinutes === null) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(scheduleMinutes - preferredMinutes);
}

export function sortSchedulesByPreferredTime(schedules, preferredExamTime) {
  const preferred = normalizeExamTimeInput(preferredExamTime);
  if (!preferred) {
    return [...schedules].sort((a, b) => {
      const aTime = a.startDateTime ? new Date(a.startDateTime).getTime() : 0;
      const bTime = b.startDateTime ? new Date(b.startDateTime).getTime() : 0;
      return aTime - bTime;
    });
  }

  return [...schedules].sort(
    (a, b) =>
      scheduleTimeDistanceMinutes(a.startDateTime, preferred) -
      scheduleTimeDistanceMinutes(b.startDateTime, preferred)
  );
}

export function applicantPreferredTimeDistance(applicant, schedule) {
  return scheduleTimeDistanceMinutes(schedule?.startDateTime, applicant?.preferredExamTime);
}

function timeToMinutes(value) {
  const [hours = 0, minutes = 0] = String(value || "")
    .trim()
    .slice(0, 5)
    .split(":")
    .map(Number);
  return hours * 60 + minutes;
}

export function timeIsWithinRange(time, startTime, endTime) {
  const target = timeToMinutes(time);
  if (!Number.isFinite(target)) {
    return false;
  }
  return target >= timeToMinutes(startTime) && target <= timeToMinutes(endTime);
}

export function timeMatchesRequestedSlot(requestedTime, rangeStart, rangeEnd, candidateTime) {
  if (!requestedTime) {
    return true;
  }
  if (candidateTime === requestedTime) {
    return true;
  }
  return timeIsWithinRange(requestedTime, rangeStart, rangeEnd);
}
