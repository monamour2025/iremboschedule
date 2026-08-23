import { loadEnvFiles } from "../lib/loadEnv.js";
import { prisma } from "../lib/db.js";

loadEnvFiles();

const logs = await prisma.automationLog.findMany({
  where: { applicantId: 3 },
  orderBy: { createdAt: "desc" },
  take: 10
});

for (const log of logs) {
  console.log("\n---", log.action, log.success, log.createdAt.toISOString(), "---");
  console.log("error:", log.errorMessage?.slice(0, 300));
  if (log.responsePayload) {
    console.log("response:", JSON.stringify(log.responsePayload)?.slice(0, 400));
  }
}

await prisma.$disconnect();
