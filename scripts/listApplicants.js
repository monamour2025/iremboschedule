import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const rows = await prisma.applicant.findMany({
  take: 5,
  orderBy: { id: "desc" },
  select: { fullName: true, nationalIdEnc: true }
});

for (const row of rows) {
  console.log(row.fullName, decryptNationalId(row.nationalIdEnc).slice(0, 4) + "************");
}

await prisma.$disconnect();
