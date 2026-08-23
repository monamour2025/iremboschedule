import axios from "axios";
import fs from "node:fs";

const page = await axios.get(
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  { timeout: 20000, validateStatus: () => true }
);
const html = String(page.data);
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
const main = scripts.find((script) => script.includes("main."));
console.log("main", main);

const js = await axios.get(`https://irembo.gov.rw/${main.replace(/^\//, "")}`, {
  timeout: 60000,
  validateStatus: () => true
});
const source = String(js.data);
fs.mkdirSync("scripts/.probe-cache", { recursive: true });
fs.writeFileSync("scripts/.probe-cache/main-fresh.js", source);

for (const term of [
  "approvingOfficeLocationId",
  "collectionOffice",
  "by-location-and-code",
  "officeCode",
  "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  "ddl-registration",
  "createApplication"
]) {
  const idx = source.indexOf(term);
  console.log("\n===", term, idx >= 0 ? "FOUND" : "NOT FOUND", "===");
  if (idx >= 0) {
    console.log(source.slice(Math.max(0, idx - 250), idx + 500));
  }
}
