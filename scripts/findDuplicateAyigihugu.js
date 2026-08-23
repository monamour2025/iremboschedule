import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { hashNationalId } from "../lib/encryption.js";

loadEnvFiles();

const name = "AYIGIHUGU";
const rows = await prisma.applicant.findMany({
  where: { fullName: { contains: name, mode: "insensitive" } },
  orderBy: { id: "asc" },
  include: { batch: true }
});

for (const row of rows) {
  console.log({
    id: row.id,
    fullName: row.fullName,
    status: row.status,
    entityId: row.entityId,
    batchId: row.batchId,
    batchName: row.batch?.name,
    batchStatus: row.batch?.status,
    nationalIdHash: row.nationalIdHash?.slice(0, 12) + "...",
    lastError: row.lastError
  });
}

console.log("total applicants", await prisma.applicant.count());
await prisma.$disconnect();
