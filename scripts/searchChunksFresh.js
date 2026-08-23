import fs from "node:fs";
import axios from "axios";

const main = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const chunks = [...main.matchAll(/"(\d+\.[a-f0-9]+\.js)"/g)].map((match) => match[1]);
console.log("chunks", chunks.length);

for (const chunk of chunks) {
  try {
    const response = await axios.get(`https://irembo.gov.rw/${chunk}`, {
      timeout: 15000,
      validateStatus: () => true
    });
    const source = String(response.data);
    if (
      source.includes("approvingOfficeLocationId") ||
      source.includes("provisionalLicenseNumber") ||
      source.includes("createDdl") ||
      source.includes("ddl-registration")
    ) {
      console.log("\nHIT", chunk);
      for (const term of [
        "approvingOfficeLocationId",
        "provisionalLicenseNumber",
        "nls",
        "createDdl",
        "ddl-registration"
      ]) {
        const idx = source.indexOf(term);
        if (idx >= 0) {
          console.log(term, source.slice(Math.max(0, idx - 120), idx + 220));
        }
      }
    }
  } catch {
    // ignore
  }
}
