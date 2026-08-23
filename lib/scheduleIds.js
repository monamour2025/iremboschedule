const GUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isBookableScheduleId(value) {
  const raw = extractRawScheduleId(value);
  return GUID_REGEX.test(raw);
}

export function extractRawScheduleId(scheduleId) {
  const value = String(scheduleId || "").trim();
  if (!value) {
    return "";
  }

  if (GUID_REGEX.test(value)) {
    return value;
  }

  const parts = value.split(":");
  for (const part of parts) {
    if (GUID_REGEX.test(part)) {
      return part;
    }
  }

  return value.includes(":") ? parts.slice(1).join(":") : value;
}

export function extractBookableScheduleId(row) {
  if (!row || typeof row !== "object") {
    return "";
  }

  const candidates = [
    row.scheduleID,
    row.scheduleId,
    row.examScheduleId,
    row.id,
    row.scheduleGuid,
    row.uuid,
    row.code,
    row.scheduleCode,
    row.slotId,
    row.guid
  ];

  for (const candidate of candidates) {
    const raw = extractRawScheduleId(candidate);
    if (GUID_REGEX.test(raw)) {
      return raw;
    }
  }

  return "";
}

export function extractGuidFromRow(row) {
  return extractBookableScheduleId(row);
}
