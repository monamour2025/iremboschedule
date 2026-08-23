import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";
import { getCitizenProfile } from "../providers/iremboApplicationProvider.js";

loadEnvFiles();

const name = process.argv[2];
const applicant = name
  ? await prisma.applicant.findFirst({ where: { fullName: { contains: name, mode: "insensitive" } }, orderBy: { id: "desc" } })
  : await prisma.applicant.findFirst({ orderBy: { id: "desc" } });

if (!applicant) {
  console.error("No applicant found");
  process.exit(1);
}

const nationalId = decryptNationalId(applicant.nationalIdEnc);
console.log("Applicant:", applicant.fullName);
console.log("National ID:", nationalId.slice(0, 4) + "************");
console.log("Stored entityId:", applicant.entityId || "(none)");
console.log("IREMBO_CITIZEN_COOKIE set:", Boolean(process.env.IREMBO_CITIZEN_COOKIE?.trim()));

try {
  const profile = await getCitizenProfile(nationalId, { fullName: applicant.fullName });
  console.log("SUCCESS:", profile);
} catch (error) {
  console.error("FAILED:", error.message);
}

await prisma.$disconnect();
