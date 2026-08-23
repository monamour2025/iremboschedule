export function normalizeNationalIdInput(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

export function isValidNationalIdInput(value) {
  const normalized = normalizeNationalIdInput(value);
  return /^\d{13}$/.test(normalized) || /^\d{16}$/.test(normalized);
}

export function nationalIdValidationMessage(value) {
  const normalized = normalizeNationalIdInput(value);
  if (!normalized) {
    return "Enter the applicant's national ID.";
  }
  if (!/^\d+$/.test(normalized)) {
    return "National ID must contain digits only.";
  }
  if (normalized.length < 13) {
    return `National ID is too short (${normalized.length}/13 minimum).`;
  }
  if (normalized.length > 16) {
    return "National ID must be 13 or 16 digits.";
  }
  if (normalized.length !== 13 && normalized.length !== 16) {
    return "National ID must be exactly 13 or 16 digits.";
  }
  return "";
}

export function uniqueNationalIdCandidates(...values) {
  const candidates = [];
  for (const value of values) {
    const normalized = normalizeNationalIdInput(value);
    if (isValidNationalIdInput(normalized) && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }
  return candidates;
}
