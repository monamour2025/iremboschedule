import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";
import { repairStuckProfileApplicants, processFailedProfileLookups } from "../services/entityIdService.js";
import { enqueueApplicantAutomation } from "../lib/automationQueue.js";

loadEnvFiles();

const repaired = await repairStuckProfileApplicants();
console.log("Repaired stuck applicants:", repaired);

const processed = await processFailedProfileLookups();
console.log("Profile lookups attempted:", processed);

const rows = await prisma.applicant.findMany({
  where: { fullName: { in: ["NZARAMBA Daniel", "MANZI Protogene"] } },
  select: { id: true, fullName: true, status: true, entityId: true, lastError: true, batch: { select: { status: true } } }
});
console.log(JSON.stringify(rows, null, 2));

for (const row of rows) {
  if (row.entityId && row.status === "PENDING") {
    await enqueueApplicantAutomation(row.id, { force: true });
    console.log("Queued automation for", row.fullName);
  }
}

await prisma.$disconnect();
