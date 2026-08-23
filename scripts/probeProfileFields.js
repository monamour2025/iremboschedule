import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";
import { buildProfileRequestHeaders } from "../lib/iremboProfileSession.js";
import { getCitizenProfile, validateDefinitiveLicense } from "../providers/iremboApplicationProvider.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const applicant = await prisma.applicant.findUnique({ where: { id: 3 } });
const nationalId = decryptNationalId(applicant.nationalIdEnc);

const profilePayload = await axios.get("https://irembo.gov.rw/irembo/rest/public/record/external", {
  headers: await buildProfileRequestHeaders({
    identificationNumber: nationalId,
    identificationType: "NATIONAL_IDENTIFICATION",
    serviceCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
    verificationMethod: "NAME",
    verificationValue: applicant.fullName
  }),
  params: {
    identificationNumber: nationalId,
    identificationType: "NATIONAL_IDENTIFICATION",
    serviceCode: "REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE",
    verificationMethod: "NAME",
    verificationValue: applicant.fullName
  },
  validateStatus: () => true,
  timeout: 30000
});

console.log("profile keys:", Object.keys(profilePayload.data?.data || {}));
console.log("profileDto keys:", Object.keys(profilePayload.data?.data?.profileDto || {}));
console.log(JSON.stringify(profilePayload.data?.data, null, 2).slice(0, 3000));

const license = await validateDefinitiveLicense(nationalId);
console.log("\nlicense:", license);

await prisma.$disconnect();
