import { loadEnvFiles } from "../lib/loadEnv.js";

loadEnvFiles();
process.env.AUTOMATION_INLINE = "1";
process.env.IREMBO_EXPAND_TIME_SLOTS = "false";
delete process.env.VERCEL;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it as a GitHub Actions secret.");
  process.exit(1);
}

const { runAutomationTick } = await import("../lib/automationTick.js");
const { prisma } = await import("../lib/db.js");

try {
  const { resumeApplicantSearch } = await import("../services/applicantService.js");
  const resumed = await resumeApplicantSearch();
  const result = await runAutomationTick({ includeScan: true, cronScan: true, force: true });
  console.log(
    JSON.stringify({
      ok: true,
      resumed: resumed.resumed || 0,
      skipped: Boolean(result.skipped),
      skipReason: result.skipReason || null,
      scanned: Boolean(result.scanned),
      scanOk: result.scan?.ok ?? null,
      recovered: result.recovered?.value || null,
      waitingOk: result.waiting?.ok ?? null,
      waitingMatched: Array.isArray(result.waiting?.value) ? result.waiting.value.length : null,
      pendingOk: result.pending?.ok ?? null
    })
  );
} finally {
  await prisma.$disconnect();
}
