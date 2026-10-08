import { loadEnvFiles } from "../lib/loadEnv.js";

loadEnvFiles();
process.env.AUTOMATION_INLINE = "1";
process.env.IREMBO_EXPAND_TIME_SLOTS = "false";
delete process.env.VERCEL;
delete process.env.IREMBO_CITIZEN_COOKIE;
delete process.env.IREMBO_USERNAME;
delete process.env.IREMBO_PASSWORD;
delete process.env.IREMBO_OTP;
delete process.env.IREMBO_PLATFORM_TOKEN;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it as a GitHub Actions secret.");
  process.exit(1);
}

const { prisma } = await import("../lib/db.js");
const { extractLicenseCategoryToken } = await import("../lib/scheduleTime.js");

const waitingCats = await prisma.applicant.findMany({
  where: { status: "WAITING_FOR_SLOT", searchPaused: false },
  select: { requestedLicenseCategory: true, licenseCategory: true }
});
const categories = [
  ...new Set(
    waitingCats
      .map((row) => extractLicenseCategoryToken(row.requestedLicenseCategory || row.licenseCategory))
      .filter(Boolean)
  )
];
if (categories.length > 0) {
  process.env.IREMBO_CATEGORIES = categories.join(",");
}

const { runAutomationTick } = await import("../lib/automationTick.js");

try {
  const { resumeApplicantSearch } = await import("../services/applicantService.js");
  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET "lastFailedScheduleId" = NULL
    WHERE status = 'WAITING_FOR_SLOT'
      AND "lastFailedScheduleId" IS NOT NULL
  `);
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
