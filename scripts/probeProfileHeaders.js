import axios from "axios";
import crypto from "node:crypto";
import { bootstrapProfileSession } from "../lib/iremboProfileSession.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

await bootstrapProfileSession(true);

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

const base = await buildProfileRequestHeaders(ctx);
const r = await axios.get("https://irembo.gov.rw/irembo/rest/public/record/external", {
  headers: {
    ...base,
    ...ctx,
    RPK: rpk(),
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,rw;q=0.8",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Sec-CH-UA": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Requested-With": "XMLHttpRequest"
  },
  validateStatus: () => true,
  timeout: 30000
});

console.log(r.status, JSON.stringify(r.data)?.slice(0, 400));
