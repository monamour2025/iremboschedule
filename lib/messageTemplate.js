export function renderDetectionMessage(template, schedule) {
  const base = template || "Category {category} detected at {center} ({location}) · {slots} slots open";

  return base
    .replaceAll("{category}", schedule?.category || "Unknown")
    .replaceAll("{center}", schedule?.center || "Unknown center")
    .replaceAll("{location}", schedule?.location || "Unknown location")
    .replaceAll("{slots}", String(schedule?.remainingCapacity ?? "?"))
    .replaceAll("{capacity}", String(schedule?.remainingCapacity ?? "?"))
    .replaceAll("{maximum}", String(schedule?.maximumCapacity ?? "?"))
    .replaceAll("{start}", schedule?.startDateTime ? new Date(schedule.startDateTime).toLocaleString("en") : "Unknown");
}

export const messageTemplateHint =
  "Use placeholders: {category}, {center}, {location}, {slots}, {start}";
