import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { validateDefinitiveLicense, reserveTemporarySlot } from "../providers/iremboApplicationProvider.js";
import { queryFilteredSchedules } from "../providers/iremboProvider.js";
import { extractBookableScheduleId } from "../lib/scheduleIds.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const page = await axios.get("https://irembo.gov.rw/home/citizen/all_services", {
  validateStatus: () => true
});
const html = String(page.data);
const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
const chunks = scripts.filter((script) => script.endsWith(".js"));

for (const script of chunks.slice(0, 40)) {
  const url = script.startsWith("http") ? script : `https://irembo.gov.rw/${script.replace(/^\//, "")}`;
  try {
    const response = await axios.get(url, { validateStatus: () => true, timeout: 10000 });
    const source = String(response.data);
    if (source.includes("approvingOfficeLocationId")) {
      const idx = source.indexOf("approvingOfficeLocationId");
      console.log("FOUND in", script);
      console.log(source.slice(Math.max(0, idx - 250), idx + 450));
    }
  } catch {
    // ignore chunk fetch failures
  }
}

const applicant = await prisma.applicant.findUnique({ where: { id: 3 } });
await validateDefinitiveLicense(decryptNationalId(applicant.nationalIdEnc));
const row = (
  await queryFilteredSchedules({
    category: "B",
    location: "Musanze",
    page: 1,
    limit: 5,
    selectedDate: "2026-08-12",
    startTime: "07:00",
    endTime: "09:00",
    testCenter: "MUSANZE SITE (MUS)"
  })
)[0];
console.log("locationName", row.locationName, "center", row.center);

const headers = await buildProfileRequestHeaders({
  category: "B",
  location: "Musanze",
  service: "PRACTICAL_EXAM",
  beneficiaries: "PrivateCandidate"
});

for (const path of [
  "/irembo/rest/public/police/v2/request/schedule-locations",
  "/irembo/rest/public/location/all",
  "/irembo/rest/public/location/districts",
  "/irembo/rest/public/record/location",
  "/irembo/rest/public/service/location"
]) {
  const response = await axios.get(`https://irembo.gov.rw${path}`, {
    headers,
    validateStatus: () => true,
    timeout: 10000
  });
  if (response.status !== 404) {
    console.log(path, response.status, JSON.stringify(response.data)?.slice(0, 400));
  }
}

await prisma.$disconnect();
