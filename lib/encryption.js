import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const raw = process.env.ENCRYPTION_KEY || "change-me-in-production-32chars!!";
  return crypto.createHash("sha256").update(raw).digest();
}

export function hashNationalId(nationalId) {
  return crypto.createHash("sha256").update(String(nationalId).trim()).digest("hex");
}

export function encryptNationalId(nationalId) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(nationalId).trim(), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptNationalId(payload) {
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + 16);
  const encrypted = buffer.subarray(IV_LENGTH + 16);
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskNationalId(nationalId) {
  const value = String(nationalId || "");
  if (value.length <= 4) {
    return "****";
  }
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}
