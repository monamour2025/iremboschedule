import fs from "node:fs";
import axios from "axios";

const main = fs.readFileSync("scripts/.probe-cache/main.js", "utf8");
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
      source.includes("approvingOffice") ||
      source.includes("pickup") ||
      source.includes("office-location") ||
      source.includes("police/v2/request")
    ) {
      console.log("\nHIT", chunk);
      for (const term of [
        "approvingOfficeLocationId",
        "approvingOfficeLocation",
        "pickup",
        "office-location",
        "police/v2/request/"
      ]) {
        const idx = source.indexOf(term);
        if (idx >= 0) {
          console.log(term, source.slice(idx, idx + 180));
        }
      }
    }
  } catch {
    // ignore
  }
}
