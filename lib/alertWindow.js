const DEFAULT_TIMEZONE = process.env.ALERT_TIMEZONE || "Africa/Kigali";

export function getTimezone() {
  return DEFAULT_TIMEZONE;
}

export function getCurrentHour(date = new Date(), timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23"
  }).formatToParts(date);

  const hourPart = parts.find((part) => part.type === "hour");
  return Number(hourPart?.value ?? date.getHours());
}

export function isValidTimeWindow(startHour, endHour) {
  return Number(startHour) !== Number(endHour);
}

export function isWithinTimeWindow(date, startHour, endHour, timezone = DEFAULT_TIMEZONE) {
  if (!isValidTimeWindow(startHour, endHour)) {
    return false;
  }

  const hour = getCurrentHour(date, timezone);

  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }

  return hour >= startHour || hour < endHour;
}

export function getWindowStatus(startHour, endHour, date = new Date(), timezone = DEFAULT_TIMEZONE) {
  if (!isValidTimeWindow(startHour, endHour)) {
    return {
      activeNow: false,
      label: "Invalid window",
      detail: "Start and end hour must be different."
    };
  }

  const activeNow = isWithinTimeWindow(date, startHour, endHour, timezone);
  return {
    activeNow,
    label: activeNow ? "Active now" : "Outside window",
    detail: activeNow
      ? `Alerts fire until ${formatHourLabel(endHour)}.`
      : `Next window starts at ${formatHourLabel(startHour)}.`
  };
}

export function formatHourLabel(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24;
  return `${String(normalized).padStart(2, "0")}:00`;
}

export function formatWindowLabel(startHour, endHour) {
  return `${formatHourLabel(startHour)} – ${formatHourLabel(endHour)}`;
}
