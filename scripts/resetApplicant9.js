import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";

loadEnvFiles();

await prisma.applicant.update({
  where: { id: 9 },
  data: { status: "SAVED", lastError: null, entityId: null }
});

console.log("Reset applicant 9 to SAVED");
await prisma.$disconnect();
