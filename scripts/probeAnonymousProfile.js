import axios from "axios";
import crypto from "node:crypto";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { captureIremboResponseCookies } from "../providers/iremboProvider.js";

loadEnvFiles();

const cookieJar = new Map();
function storeCookies(headers) {
  for (const raw of headers?.["set-cookie"] || []) {
    const part = raw.split(";")[0];
    cookieJar.set(part.split("=")[0], part);
  }
}
function cookieHeader() {
  return [...cookieJar.values()].join("; ");
}

const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function warm(url, extra = {}) {
  const r = await axios.get(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": ua,
      Cookie: cookieHeader(),
      ...extra
    },
    validateStatus: () => true,
    timeout: 20000,
    maxRedirects: 5
  });
  storeCookies(r.headers);
  return r.status;
}

const serviceUrl =
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";

for (const url of [
  "https://irembo.gov.rw/",
  "https://irembo.gov.rw/home/citizen/all_services",
  serviceUrl
]) {
  console.log("warm", url, await warm(url, url === serviceUrl ? { Referer: "https://irembo.gov.rw/home/citizen/all_services" } : {}));
}

console.log("cookies", [...cookieJar.keys()]);

function rpk() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });
  return publicKey.toString("base64");
}

const ctx = {
  identificationNumber: "1199780123456789",
  identificationType: "NATIONAL_IDENTIFICATION",
  serviceCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  verificationMethod: "NAME",
  verificationValue: "TEST USER"
};

const profileHeaders = {
  ...(await buildProfileRequestHeaders(ctx)),
  Cookie: cookieHeader(),
  RPK: rpk(),
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin"
};

for (const url of [
  "https://irembo.gov.rw/irembo/rest/public/record/external",
  "https://irembo.gov.rw/irembo/rest/public/record/external/id"
]) {
  const r = await axios.get(url, {
    headers: profileHeaders,
    validateStatus: () => true,
    timeout: 20000
  });
  captureIremboResponseCookies(r.headers);
  console.log("\n", url, r.status, JSON.stringify(r.data)?.slice(0, 400));
}

// Try with ignoreAuthToken like exchange uses
const r2 = await axios.get("https://irembo.gov.rw/irembo/rest/public/record/external", {
  headers: { ...profileHeaders, ignoreAuthToken: "TRUE", Authorization: "" },
  validateStatus: () => true,
  timeout: 20000
});
console.log("\nwith ignoreAuthToken", r2.status, JSON.stringify(r2.data)?.slice(0, 200));
