import axios from "axios";
import { logger } from "./logger.js";

const SERVICE_REFERER =
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";

const WARM_URLS = [
  { url: "https://irembo.gov.rw/", referer: undefined },
  { url: "https://irembo.gov.rw/home/citizen/all_services", referer: "https://irembo.gov.rw/" },
  { url: SERVICE_REFERER, referer: "https://irembo.gov.rw/home/citizen/all_services" }
];

const cookieJar = new Map();
let lastWarmAt = 0;
const WARM_TTL_MS = Number(process.env.IREMBO_SESSION_WARM_TTL_MS || 60_000);

function userAgent() {
  return (
    process.env.IREMBO_USER_AGENT ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
}

function storeCookies(headers) {
  for (const raw of headers?.["set-cookie"] || []) {
    const part = String(raw).split(";")[0];
    const name = part.split("=")[0];
    if (name) {
      cookieJar.set(name, part);
    }
  }
}

export function getIremboCookieString() {
  return [...cookieJar.values()].join("; ");
}

export function mergeCookieString(extra = "") {
  const parts = [extra, getIremboCookieString()].filter(Boolean);
  return parts.join("; ");
}

export async function warmIremboSession(force = false) {
  const now = Date.now();
  if (!force && lastWarmAt && now - lastWarmAt < WARM_TTL_MS && cookieJar.size > 0) {
    return getIremboCookieString();
  }

  for (const step of WARM_URLS) {
    try {
      const response = await axios.get(step.url, {
        timeout: Number(process.env.IREMBO_REQUEST_TIMEOUT_MS || 15000),
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,rw;q=0.8",
          "User-Agent": userAgent(),
          ...(step.referer ? { Referer: step.referer } : {}),
          ...(cookieJar.size ? { Cookie: getIremboCookieString() } : {})
        },
        validateStatus: (status) => status >= 200 && status < 500,
        maxRedirects: 5
      });
      storeCookies(response.headers);
    } catch (error) {
      logger.warn("Irembo session warm step failed", { url: step.url, message: error.message });
    }
  }

  lastWarmAt = Date.now();
  logger.info("Irembo browser session warmed", { cookies: cookieJar.size });
  return getIremboCookieString();
}

export function applyIremboResponseCookies(headers) {
  storeCookies(headers);
}
