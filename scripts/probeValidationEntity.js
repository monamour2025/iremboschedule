import axios from "axios";
import crypto from "node:crypto";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";

loadEnvFiles();

function rpk() {
  const { publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" }
  });
  return publicKey.toString("base64");
}

const nationalId = process.argv[2] || "1199780123456789";
const headers = await buildProfileRequestHeaders({ RPK: rpk() });

const val = await axios.post(
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request/registration-validation/definitive",
  { nationalId },
  {
    headers: { ...headers, "Content-Type": "application/json" },
    validateStatus: () => true,
    timeout: 30000
  }
);
console.log("validation status", val.status);
console.log(JSON.stringify(val.data, null, 2)?.slice(0, 3000));

// search all keys for entity/guid/id
function walk(obj, path = "") {
  if (!obj || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const p = path ? `${path}.${k}` : k;
    if (/entity|guid|profile|citizen|account/i.test(k)) console.log(p, "=", v);
    if (v && typeof v === "object") walk(v, p);
  }
}
walk(val.data);
