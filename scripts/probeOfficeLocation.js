import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { validateDefinitiveLicense, reserveTemporarySlot } from "../providers/iremboApplicationProvider.js";
import { queryFilteredSchedules } from "../providers/iremboProvider.js";
import { extractBookableScheduleId } from "../lib/scheduleIds.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const page = await axios.get(
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
  { validateStatus: () => true, timeout: 15000 }
);
const html = String(page.data);
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
const main = scripts.find((script) => script.includes("main."));
if (main) {
  const mainJs = await axios.get(`https://irembo.gov.rw/${main.replace(/^\//, "")}`, {
    validateStatus: () => true
  });
  const source = String(mainJs.data);
  const idx = source.indexOf("approvingOfficeLocationId");
  console.log("bundle approvingOfficeLocationId at", idx);
  if (idx >= 0) {
    console.log(source.slice(Math.max(0, idx - 300), idx + 500));
  }
  for (const term of ["approvingOffice", "officeLocation", "schedule-locations", "pickupLocation"]) {
    const termIdx = source.indexOf(term);
    if (termIdx >= 0) {
      console.log(`\nterm ${term} at ${termIdx}:`, source.slice(termIdx, termIdx + 200));
    }
  }
}

const applicant = await prisma.applicant.findUnique({ where: { id: 3 } });
const nationalId = decryptNationalId(applicant.nationalIdEnc);
await validateDefinitiveLicense(nationalId);

const rows = await queryFilteredSchedules({
  category: "B",
  location: "Musanze",
  page: 1,
  limit: 3,
  selectedDate: "2026-08-12",
  startTime: "07:00",
  endTime: "09:00",
  testCenter: "MUSANZE SITE (MUS)"
});
const row = rows.find((entry) => entry.center?.includes("MUSANZE")) || rows[0];
console.log("\nschedule row keys:", Object.keys(row));

const scheduleID = extractBookableScheduleId(row);
const bookingId = await reserveTemporarySlot(scheduleID, { category: "B", location: "Musanze" });
console.log("bookingId", bookingId);

const headers = await buildProfileRequestHeaders({
  "Content-Type": "application/json",
  category: "B",
  location: "Musanze"
});

for (const url of [
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request/approving-office-location-id",
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request/approving-office-location-ids",
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request/location-id",
  "https://irembo.gov.rw/irembo/rest/public/police/v2/request/schedule-location-id"
]) {
  const response = await axios.get(url, {
    headers,
    params: { location: "Musanze", category: "B" },
    validateStatus: () => true,
    timeout: 10000
  });
  if (response.status !== 404) {
    console.log(url.split("/").pop(), response.status, JSON.stringify(response.data)?.slice(0, 300));
  }
}

await prisma.$disconnect();
