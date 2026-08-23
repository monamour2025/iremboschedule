import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";
import { getCitizenProfile } from "../providers/iremboApplicationProvider.js";

loadEnvFiles();

const row = await prisma.applicant.findFirst({ orderBy: { id: "desc" } });
const nationalId = decryptNationalId(row.nationalIdEnc);
console.log("Testing", row.fullName, nationalId.slice(0, 4) + "************");

try {
  const profile = await getCitizenProfile(nationalId, { fullName: row.fullName });
  console.log("SUCCESS", profile);
} catch (e) {
  console.error("FAILED", e.message);
}

await prisma.$disconnect();
