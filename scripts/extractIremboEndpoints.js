import axios from "axios";
import fs from "node:fs";
import path from "node:path";

const cacheDir = path.resolve("scripts/.probe-cache");
fs.mkdirSync(cacheDir, { recursive: true });

const page = await axios.get(
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  { validateStatus: () => true }
);
const html = String(page.data);
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
const main = scripts.find((script) => script.includes("main."));
const mainUrl = `https://irembo.gov.rw/${main.replace(/^\//, "")}`;
const mainJs = await axios.get(mainUrl, { validateStatus: () => true });
const mainSource = String(mainJs.data);
fs.writeFileSync(path.join(cacheDir, "main.js"), mainSource);

const chunkNames = [...mainSource.matchAll(/"(\d+\.[a-f0-9]+\.js)"/g)].map((match) => match[1]);
const endpointHits = new Set();

for (const chunk of chunkNames) {
  const url = `https://irembo.gov.rw/${chunk}`;
  try {
    const response = await axios.get(url, { validateStatus: () => true, timeout: 15000 });
    const source = String(response.data);
    fs.writeFileSync(path.join(cacheDir, chunk), source);
    for (const match of source.matchAll(/police\/v2\/request\/[a-z0-9-]+/g)) {
      endpointHits.add(match[0]);
    }
    if (source.includes("approvingOfficeLocationId")) {
      const idx = source.indexOf("approvingOfficeLocationId");
      console.log("approvingOfficeLocationId in", chunk);
      console.log(source.slice(Math.max(0, idx - 200), idx + 400));
    }
  } catch (error) {
    console.log("chunk failed", chunk, error.message);
  }
}

console.log("\nEndpoints:");
console.log([...endpointHits].sort().join("\n"));

for (const term of [
  "approvingOfficeLocationId",
  "approvingOfficeLocation",
  "collectionOffice",
  "officeLocation"
]) {
  const idx = mainSource.indexOf(term);
  if (idx >= 0) {
    console.log(`\nmain ${term}:`, mainSource.slice(idx, idx + 200));
  }
}
