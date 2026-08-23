import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { queryFilteredSchedules } from "../providers/iremboProvider.js";
import { extractBookableScheduleId } from "../lib/scheduleIds.js";
import { validateDefinitiveLicense, reserveTemporarySlot } from "../providers/iremboApplicationProvider.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const applicantId = Number(process.argv[2] || 3);

const applicant = await prisma.applicant.findUnique({ where: { id: applicantId } });
if (!applicant) {
  throw new Error(`Applicant ${applicantId} not found`);
}

const nationalId = decryptNationalId(applicant.nationalIdEnc);
const license = await validateDefinitiveLicense(nationalId);
const entityId = applicant.entityId;

const rows = await queryFilteredSchedules({
  category: applicant.licenseCategory,
  location: applicant.preferredLocation,
  page: 1,
  limit: 5,
  selectedDate: "2026-08-12",
  startTime: "07:00",
  endTime: "09:00",
  testCenter: applicant.examCenter || undefined
});

const row = rows[0];
if (!row) {
  throw new Error("No schedule rows returned");
}

console.log("row keys:", Object.keys(row));
console.log("row sample:", JSON.stringify(row, null, 2));

const scheduleID = extractBookableScheduleId(row);
const bookingId = await reserveTemporarySlot(scheduleID, {
  category: applicant.licenseCategory,
  location: applicant.preferredLocation
});

const headers = await buildProfileRequestHeaders({});
const dist = await axios.get("https://irembo.gov.rw/irembo/rest/public/location/district", {
  headers,
  validateStatus: () => true,
  timeout: 15000
});
const districts = dist.data?.data || [];
const district = districts.find((entry) => entry.name === applicant.preferredLocation);
console.log("district guid:", district?.guid);

const officeList = await axios.get("https://irembo.gov.rw/irembo/rest/public/office/", {
  headers: {
    ...headers,
    applicationCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
    locationId: district?.guid
  },
  validateStatus: () => true,
  timeout: 15000
});
const offices = officeList.data?.data || [];
console.log(
  "offices:",
  offices.map((office) => ({ code: office.code, name: office.name, guid: office.guid }))
);

const candidates = [{ label: "rnp-hq-office", approvingOfficeLocationId: offices[0]?.guid }];

for (const candidate of candidates) {
  if (!candidate.approvingOfficeLocationId) {
    continue;
  }

  const nlsVariants = ["ENGLISH", "English", "KINYARWANDA", "FRENCH"];
  for (const nls of nlsVariants) {
    const body = {
      requesterId: entityId,
      applicantId: entityId,
      creatorId: entityId,
      creatorType: "CITIZEN",
      applicantType: "INDIVIDUAL",
      applicationType: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
      examScheduleId: scheduleID,
      temporaryBookingId: bookingId,
      licenseCategoryRequested: applicant.licenseCategory,
      examCenterName: row.center || applicant.examCenter,
      examFormat: "PRACTICAL",
      examLanguage: nls === "English" ? "English" : nls,
      nls,
      examScheduleDate: new Date("2026-08-12T07:00:00.000Z").toISOString(),
      notificationPhone: applicant.phone,
      notificationEmail: applicant.email,
      amount: Number(row.price || row.examFee || 10000),
      provisionalLicenseNumber: license.licenseNumber,
      approvingOfficeLocationId: candidate.approvingOfficeLocationId
    };

    const response = await axios.post(
      "https://irembo.gov.rw/irembo/rest/public/police/v2/create/ddl-registration/application",
      body,
      {
        headers: await buildProfileRequestHeaders({
          "Content-Type": "application/json",
          NLS: nls === "English" ? "English" : nls
        }),
        validateStatus: () => true,
        timeout: 30000
      }
    );

    console.log(
      candidate.label,
      "nls=",
      nls,
      response.status,
      JSON.stringify(response.data)?.slice(0, 600)
    );

    if (response.data?.status === true) {
      break;
    }
  }
}

await prisma.$disconnect();
