import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";

loadEnvFiles();

const user = process.env.IREMBO_USERNAME || "";
const pass = process.env.IREMBO_PASSWORD || "";

const bases = [
  "https://irembo.gov.rw/irembo",
  "https://irembo.gov.rw/irembo/rest/accounts"
];

for (const base of bases) {
  for (const path of ["/public/authenticate", "/authenticate", "/login"]) {
    try {
      const r = await axios.post(
        `${base}${path}`,
        { username: user || "0000000000000000", password: pass || "bad" },
        { validateStatus: () => true, timeout: 15000 }
      );
      console.log(base + path, r.status, JSON.stringify(r.data)?.slice(0, 200));
    } catch (e) {
      console.log(base + path, "ERR", e.message);
    }
  }
}

// exchange endpoint
const ex = await axios.post(
  "https://irembo.gov.rw/irembo/rest/public/exchange",
  { token: "bad" },
  { validateStatus: () => true, timeout: 15000 }
);
console.log("exchange", ex.status, JSON.stringify(ex.data)?.slice(0, 200));
