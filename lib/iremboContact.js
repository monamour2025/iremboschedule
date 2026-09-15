const RWANDA_MOBILE_REGEX = /^(\+250|250|0)?7[2389]\d{7}$/;

export function normalizeRwandaPhone(phone) {
  const raw = String(phone || "").trim().replace(/\s+/g, "");
  if (!raw) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("250") && digits.length === 12) {
    return `0${digits.slice(3)}`;
  }
  if (digits.startsWith("0") && digits.length === 10) {
    return digits;
  }
  if (digits.length === 9 && /^7/.test(digits)) {
    return `0${digits}`;
  }

  return raw;
}

export function isValidRwandaMobile(phone) {
  const normalized = normalizeRwandaPhone(phone);
  return RWANDA_MOBILE_REGEX.test(normalized);
}

export function isRealNotificationEmail(email) {
  const value = String(email || "").trim();
  if (!value || value.includes("@placeholder.local")) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function resolveIremboNotificationContact({ phone, email }) {
  const notificationPhone = normalizeRwandaPhone(phone);
  const rawEmail = String(email || "").trim();
  const notificationEmail = isRealNotificationEmail(rawEmail) ? rawEmail : "";

  if (!isValidRwandaMobile(notificationPhone)) {
    throw new Error(
      "Phone must be a valid Rwanda mobile number (e.g. 0781234567). Irembo sends payment SMS to this number."
    );
  }

  if (rawEmail && !notificationEmail) {
    throw new Error("Email must be a valid address, or leave it blank.");
  }

  return { notificationPhone, notificationEmail };
}
