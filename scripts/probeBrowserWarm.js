import axios from "axios";
import crypto from "node:crypto";
import { loadEnvFiles } from "../lib/loadEnv.js";

loadEnvFiles();

const cookieJar = [];

function storeCookies(headers) {
  const setCookie = headers?.["set-cookie"];
  if (!Array.isArray(setCookie)) return;
  for (const raw of setCookie) {
    const part = raw.split(";")[0];
    const name = part.split("=")[0];
    const idx = cookieJar.findIndex((c) => c.startsWith(`${name}=`));
    if (idx >= 0) cookieJar[idx] = part;
    else cookieJar.push(part);
  }
}

function cookieHeader() {
  return cookieJar.join("; ");
}

const ua =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function warm(url) {
  const r = await axios.get(url, {
    headers: { Accept: "text/html", "User-Agent": ua, Cookie: cookieHeader() },
    validateStatus: () => true,
    timeout: 15000
  });
  storeCookies(r.headers);
  return r.status;
}

const pages = [
  "https://irembo.gov.rw/",
  "https://irembo.gov.rw/home/citizen/all_services",
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE"
];

for (const p of pages) {
  console.log("warm", p, await warm(p));
}
console.log("cookies", cookieJar.length, cookieJar.map((c) => c.split("=")[0]).join(", "));

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

const r = await axios.get("https://irembo.gov.rw/irembo/rest/public/record/external", {
  headers: {
    Accept: "application/json, text/plain, */*",
    "User-Agent": ua,
    Cookie: cookieHeader(),
    Referer: pages[2],
    Origin: "https://irembo.gov.rw",
    RPK: rpk(),
    ...ctx
  },
  validateStatus: () => true,
  timeout: 20000
});
console.log("\nprofile", r.status, JSON.stringify(r.data)?.slice(0, 400));

// definitive validation - does it return entityId?
const val = await axios.post(
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request/registration-validation/definitive",
  { nationalId: "1199780123456789" },
  {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": ua,
      Cookie: cookieHeader(),
      Referer: pages[2],
      Origin: "https://irembo.gov.rw",
      RPK: rpk()
    },
    validateStatus: () => true,
    timeout: 20000
  }
);
console.log("\nvalidation", val.status, JSON.stringify(val.data)?.slice(0, 500));
