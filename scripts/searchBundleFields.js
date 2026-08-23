import fs from "node:fs";

const source = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const terms = [
  "nlsValue",
  "provisionalLicenseNumber",
  "licenseCategoryRequested",
  "examCenterName",
  "approvingOfficeLocationId",
  "createDdl",
  "createDefinitive",
  "ddl-registration/application"
];

for (const term of terms) {
  let idx = 0;
  let count = 0;
  while ((idx = source.indexOf(term, idx)) >= 0 && count < 3) {
    console.log(`\n--- ${term} #${count} at ${idx} ---`);
    console.log(source.slice(Math.max(0, idx - 200), idx + 400));
    idx += 1;
    count += 1;
  }
}
