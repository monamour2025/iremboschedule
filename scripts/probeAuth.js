import { loadEnvFiles } from "../lib/loadEnv.js";
import axios from "axios";

loadEnvFiles();

const s = await import("node:fs").then((fs) =>
  fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8")
);

for (const term of ["W0={", "NZ={", "auth/public/authenticate", "/irembo/rest/auth"]) {
  const i = s.indexOf(term);
  if (i >= 0) console.log(term, ":", s.slice(i, i + 200));
}

const candidates = [
  "https://irembo.gov.rw/irembo/rest/auth/public/authenticate",
  "https://irembo.gov.rw/irembo/rest/public/auth/public/authenticate",
  "https://irembo.gov.rw/irembo/rest/authentication/public/authenticate"
];

for (const url of candidates) {
  try {
    const r = await axios.post(
      url,
      { username: "test", password: "test" },
      { validateStatus: () => true, timeout: 10000 }
    );
    console.log(url, r.status, JSON.stringify(r.data)?.slice(0, 200));
  } catch (e) {
    console.log(url, "ERR", e.message);
  }
}
