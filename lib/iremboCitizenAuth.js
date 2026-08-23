import axios from "axios";
import { logger } from "./logger.js";

const KEYCLOAK_TOKEN_URL = "https://id.irembohub.com/realms/irembo/protocol/openid-connect/token";
const EXCHANGE_URL = "https://irembo.gov.rw/irembo/public/exchange";
const CLIENT_ID = "irembo-gov-2_0-portal";
const TOKEN_TTL_MS = Number(process.env.IREMBO_PLATFORM_TOKEN_TTL_MS || 25 * 60 * 1000);

let cachedPlatformToken = process.env.IREMBO_PLATFORM_TOKEN?.trim() || null;
let cachedPlatformTokenAt = cachedPlatformToken ? Date.now() : 0;
let keycloakToken = null;
let keycloakTokenExpiresAt = 0;
let loginPromise = null;

let runtimeUsername = "";
let runtimePassword = "";

export function setRuntimeIremboCredentials(username, password) {
  runtimeUsername = String(username || "").trim();
  runtimePassword = String(password || "");
  clearIremboCitizenAuth();
}

function credentialsConfigured() {
  if (runtimeUsername && runtimePassword) {
    return true;
  }
  return Boolean(process.env.IREMBO_USERNAME?.trim() && process.env.IREMBO_PASSWORD?.trim());
}

async function fetchKeycloakToken() {
  const username = runtimeUsername || process.env.IREMBO_USERNAME.trim();
  const password = runtimePassword || process.env.IREMBO_PASSWORD.trim();

  const response = await axios.post(
    KEYCLOAK_TOKEN_URL,
    new URLSearchParams({
      grant_type: "password",
      client_id: CLIENT_ID,
      username,
      password
    }),
    {
      timeout: Number(process.env.IREMBO_REQUEST_TIMEOUT_MS || 30000),
      validateStatus: (status) => status >= 200 && status < 500
    }
  );

  if (response.status >= 400 || !response.data?.access_token) {
    const detail = response.data?.error_description || response.data?.error || "Invalid Irembo credentials.";
    throw new Error(`Irembo login failed: ${detail}`);
  }

  keycloakToken = response.data.access_token;
  keycloakTokenExpiresAt = Date.now() + Math.max(60, Number(response.data.expires_in || 300) - 60) * 1000;
  return keycloakToken;
}

async function exchangePlatformToken(accessToken) {
  const headers = {
    Authorization: "",
    ignoreAuthToken: "TRUE",
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-Origin-Metadata": "component: codes-monitor, scenario: PROFILE_LOOKUP"
  };

  const otp = process.env.IREMBO_OTP?.trim();
  if (otp) {
    headers.otpValue = otp;
    headers.invalidateCurrentActiveSession = "true";
  }

  const response = await axios.post(
    EXCHANGE_URL,
    { token: accessToken },
    {
      headers,
      timeout: Number(process.env.IREMBO_REQUEST_TIMEOUT_MS || 30000),
      validateStatus: () => true
    }
  );

  const authHeader = response.headers?.authorization || response.headers?.Authorization;
  if (response.data?.responseCode === "100000" && authHeader) {
    cachedPlatformToken = authHeader;
    cachedPlatformTokenAt = Date.now();
    logger.info("Irembo citizen session ready for profile lookups");
    return authHeader;
  }

  const message = String(response.data?.message || "Irembo session exchange failed.");
  if (/otp|two.?factor|2fa|verification code/i.test(message)) {
    throw new Error(
      "Irembo requires a one-time login code. Set IREMBO_OTP in .env to the SMS code, save, then remove it after the first successful run."
    );
  }

  throw new Error(message);
}

export function hasIremboCitizenCredentials() {
  return credentialsConfigured() || Boolean(process.env.IREMBO_PLATFORM_TOKEN?.trim());
}

export function getIremboCredentialsStatus() {
  if (process.env.IREMBO_PLATFORM_TOKEN?.trim()) {
    return { configured: true, source: "env-token" };
  }
  if (runtimeUsername && runtimePassword) {
    return { configured: true, source: "runtime", username: runtimeUsername };
  }
  if (process.env.IREMBO_USERNAME?.trim()) {
    return { configured: true, source: "env", username: process.env.IREMBO_USERNAME.trim() };
  }
  return { configured: false, source: "none" };
}

export async function ensureIremboCitizenAuth(force = false) {
  if (!force && cachedPlatformToken && Date.now() - cachedPlatformTokenAt < TOKEN_TTL_MS) {
    return cachedPlatformToken;
  }

  if (process.env.IREMBO_PLATFORM_TOKEN?.trim() && !force) {
    cachedPlatformToken = process.env.IREMBO_PLATFORM_TOKEN.trim();
    cachedPlatformTokenAt = Date.now();
    return cachedPlatformToken;
  }

  if (!credentialsConfigured()) {
    return null;
  }

  if (!loginPromise) {
    loginPromise = (async () => {
      if (!keycloakToken || Date.now() >= keycloakTokenExpiresAt) {
        await fetchKeycloakToken();
      }
      return exchangePlatformToken(keycloakToken);
    })().finally(() => {
      loginPromise = null;
    });
  }

  return loginPromise;
}

export async function getIremboCitizenAuthHeaders() {
  const token = await ensureIremboCitizenAuth();
  if (!token) {
    return {};
  }
  return { Authorization: token };
}

export function clearIremboCitizenAuth() {
  cachedPlatformToken = process.env.IREMBO_PLATFORM_TOKEN?.trim() || null;
  cachedPlatformTokenAt = cachedPlatformToken ? Date.now() : 0;
  keycloakToken = null;
  keycloakTokenExpiresAt = 0;
}
