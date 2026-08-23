import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();
const row = await prisma.applicant.findFirst({ orderBy: { id: "desc" } });
const nationalId = decryptNationalId(row.nationalIdEnc);
const fullName = row.fullName;

console.log(JSON.stringify({ nationalId, fullName }));

await prisma.$disconnect();
