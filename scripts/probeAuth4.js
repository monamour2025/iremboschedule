import axios from "axios";
import fs from "node:fs";

const candidates = [
  "https://irembo.gov.rw/irembo/rest/public/authentication/public/authenticate",
  "https://irembo.gov.rw/irembo/rest/authentication/public/authenticate",
  "https://irembo.gov.rw/irembo/rest/accounts/public/authenticate",
  "https://irembo.gov.rw/irembo/rest/accounts/authenticate",
  "https://irembo.gov.rw/irembo/rest/public/accounts/public/authenticate",
  "https://irembo.gov.rw/irembo/rest/public/authentication/authenticate",
  "https://irembo.gov.rw/irembo/rest/public/login",
  "https://irembo.gov.rw/irembo/rest/login/public/authenticate"
];

for (const url of candidates) {
  try {
    const r = await axios.post(url, { username: "x", password: "y" }, { validateStatus: () => true, timeout: 10000 });
    console.log(r.status, url, JSON.stringify(r.data)?.slice(0, 120));
  } catch (e) {
    console.log("ERR", url, e.message);
  }
}

// Try live profile without auth to see actual 423 behavior
const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const authIdx = s.indexOf('authUrl",{enumerable');
const w0 = s.match(/W0=\{[^}]+\}/);
console.log("\nW0:", w0?.[0]?.slice(0, 500));
