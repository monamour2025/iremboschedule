import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { decryptNationalId } from "../lib/encryption.js";

loadEnvFiles();

const rows = await prisma.applicant.findMany({
  where: { fullName: { contains: "AYIGIHUGU", mode: "insensitive" } },
  orderBy: { updatedAt: "desc" },
  include: { batch: true, applications: { orderBy: { createdAt: "desc" }, take: 1 } }
});

for (const row of rows) {
  console.log(JSON.stringify({
    id: row.id,
    fullName: row.fullName,
    status: row.status,
    entityId: row.entityId,
    lastError: row.lastError,
    batch: row.batch?.name,
    batchStatus: row.batch?.status,
    nid: decryptNationalId(row.nationalIdEnc).slice(0, 4) + "****",
    app: row.applications[0]?.applicationNumber || null
  }, null, 2));
}

await prisma.$disconnect();
