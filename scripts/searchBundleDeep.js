import fs from "node:fs";

const source = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const terms = [
  "examScheduleId",
  "temporaryBookingId",
  "approvingOfficeLocationId",
  "nlsValue",
  "createDefinitive",
  "createDdlRegistration",
  "ddlRegistrationApplication",
  "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE"
];

for (const term of terms) {
  let idx = 0;
  let count = 0;
  while ((idx = source.indexOf(term, idx)) >= 0 && count < 5) {
    const snippet = source.slice(Math.max(0, idx - 180), idx + 350);
    if (
      term === "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE" &&
      !/examSchedule|temporaryBooking|approvingOffice|create|application/i.test(snippet)
    ) {
      idx += 1;
      continue;
    }
    console.log(`\n--- ${term} #${count} at ${idx} ---`);
    console.log(snippet);
    idx += 1;
    count += 1;
  }
}
