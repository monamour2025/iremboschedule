import axios from "axios";
import crypto from "node:crypto";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { bootstrapProfileSession, buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { getIremboSessionHeaders, captureIremboResponseCookies } from "../providers/iremboProvider.js";

loadEnvFiles();

function getRpk() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });
  return publicKey.toString("base64");
}

await bootstrapProfileSession(true);
const base = await buildProfileRequestHeaders();
const testNid = "1199780123456789"; // fake
const ctx = {
  identificationNumber: testNid,
  identificationType: "NATIONAL_IDENTIFICATION",
  serviceCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  verificationMethod: "NAME",
  verificationValue: "TEST NAME"
};

const urls = [
  "https://irembo.gov.rw/irembo/rest/public/record/external",
  "https://irembo.gov.rw/irembo/rest/record/external",
  "https://irembo.gov.rw/irembo/rest/public/record/external/id"
];

for (const url of urls) {
  const r = await axios.get(url, {
    headers: { ...base, ...ctx, RPK: getRpk() },
    validateStatus: () => true,
    timeout: 20000
  });
  captureIremboResponseCookies(r.headers);
  console.log("\n", url);
  console.log("status", r.status, JSON.stringify(r.data)?.slice(0, 300));
}

// Test authenticate endpoint shape
const auth = await axios.post(
  "https://irembo.gov.rw/irembo/rest/accounts/authenticate",
  { username: process.env.IREMBO_USERNAME || "0000000000000000", password: process.env.IREMBO_PASSWORD || "bad" },
  { validateStatus: () => true, timeout: 15000, withCredentials: true }
);
console.log("\nauth", auth.status, JSON.stringify(auth.data)?.slice(0, 400));
console.log("set-cookie", auth.headers["set-cookie"]?.length || 0);
