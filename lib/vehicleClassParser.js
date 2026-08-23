/**
 * Parse Irembo vehicleClass strings such as "B05062017;" or "B05062017;C12012020;".
 * Returns unique category codes (e.g. B, C, B(AT)).
 */
export function parseVehicleClasses(vehicleClass) {
  if (vehicleClass === null || vehicleClass === undefined) {
    return [];
  }

  const raw = String(vehicleClass).trim();
  if (!raw) {
    return [];
  }

  const categories = [];
  const segments = raw.split(";").map((part) => part.trim()).filter(Boolean);

  for (const segment of segments) {
    const match = segment.match(/^([A-Z]+(?:\(AT\))?)/i);
    if (match?.[1]) {
      categories.push(match[1].toUpperCase() === "B(AT)" ? "B(AT)" : match[1].toUpperCase());
    }
  }

  return [...new Set(categories)];
}

export function primaryVehicleCategory(vehicleClass) {
  const parsed = parseVehicleClasses(vehicleClass);
  return parsed[0] || null;
}

export function applicantOwnsCategory(existingCategories, requestedCategory) {
  const requested = String(requestedCategory || "").trim().toUpperCase();
  if (!requested) {
    return false;
  }
  return existingCategories.some(
    (category) => String(category || "").trim().toUpperCase() === requested
  );
}

export function parseIremboDisplayDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const slashMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
