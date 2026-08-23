export function extractIremboApplicationNumber(text) {
  const match = String(text || "").match(/\b(B[0-9]{11,}[A-Z0-9]*)\b/);
  return match?.[1] || null;
}

export function isExistingApplicationMessage(message, responseCode) {
  const normalized = String(message || "");
  const code = String(responseCode || "");
  if (!extractIremboApplicationNumber(normalized)) {
    return false;
  }

  return (
    code === "100004" ||
    /koresha|ntarishyurwa|already exist|already created|duplicate/i.test(normalized)
  );
}
