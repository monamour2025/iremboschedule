"use client";

const STORAGE_KEY = "irembo-admin-secret";

export function getAdminSecret() {
  if (typeof window === "undefined") {
    return "";
  }
  return localStorage.getItem(STORAGE_KEY) || "";
}

export function setAdminSecret(value) {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY, value.trim());
}

export async function adminFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  const secret = getAdminSecret();
  if (secret) {
    headers.set("x-admin-secret", secret);
  }

  const controller = new AbortController();
  const timeoutMs = Number(options.timeoutMs || 120000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Request timed out. The server may be busy with schedule scans — wait a moment and try again.");
    }
    if (String(error?.message || "").toLowerCase() === "failed to fetch") {
      throw new Error(
        "Could not reach the server. Confirm npm run dev is running, reload the page, and enter the admin secret in the header if required."
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
