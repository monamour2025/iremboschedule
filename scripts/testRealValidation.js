import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";
import { validateDefinitiveLicense } from "../providers/iremboApplicationProvider.js";

loadEnvFiles();

const row = await prisma.applicant.findFirst({ orderBy: { id: "desc" } });
const nationalId = decryptNationalId(row.nationalIdEnc);

try {
  const license = await validateDefinitiveLicense(nationalId);
  console.log("license keys", Object.keys(license));
  console.log(JSON.stringify(license, null, 2));
} catch (e) {
  console.error("failed", e.message);
}

await prisma.$disconnect();
