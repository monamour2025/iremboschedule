import { loadEnvFiles } from "../lib/loadEnv.js";
import axios from "axios";
import crypto from "node:crypto";
import { getIremboSessionHeaders, captureIremboResponseCookies } from "../providers/iremboProvider.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const applicant = await prisma.applicant.findUnique({ where: { id: 1 } });
const nationalId = decryptNationalId(applicant.nationalIdEnc);
console.log("Testing profile for masked ID:", nationalId.slice(0, 4) + "****");

function getRpk() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });
  return publicKey.toString("base64");
}

async function bootstrapSession() {
  const r = await axios.get("https://irembo.gov.rw/home/citizen/all_services", {
    headers: {
      Accept: "text/html",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
    },
    validateStatus: () => true
  });
  captureIremboResponseCookies(r.headers);
}

await bootstrapSession();
const base = await getIremboSessionHeaders();
const url = "https://irembo.gov.rw/irembo/rest/public/record/external";

const attempts = [
  { label: "headers", headers: { ...base, identificationNumber: nationalId, identificationType: "NATIONAL_IDENTIFICATION" } },
  { label: "params", params: { identificationNumber: nationalId, identificationType: "NATIONAL_IDENTIFICATION" }, headers: base },
  { label: "headers+rpk", headers: { ...base, RPK: getRpk(), identificationNumber: nationalId, identificationType: "NATIONAL_IDENTIFICATION" } },
  { label: "params+rpk", params: { identificationNumber: nationalId, identificationType: "NATIONAL_IDENTIFICATION" }, headers: { ...base, RPK: getRpk() } }
];

for (const a of attempts) {
  const r = await axios.get(url, { ...a, validateStatus: () => true, timeout: 20000 });
  captureIremboResponseCookies(r.headers);
  const body = typeof r.data === "string" ? r.data.slice(0, 100) : JSON.stringify(r.data)?.slice(0, 200);
  console.log(a.label, r.status, body);
}

await prisma.$disconnect();
