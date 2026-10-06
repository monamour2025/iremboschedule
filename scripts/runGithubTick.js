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
const { getIremboCookieHealth } = await import("../lib/iremboBrowserSession.js");
const { hasIremboCitizenCredentials } = await import("../lib/iremboCitizenAuth.js");

try {
  const cookieHealth = getIremboCookieHealth();
  if (!cookieHealth.present && !hasIremboCitizenCredentials()) {
    console.error(
      "IREMBO_CITIZEN_COOKIE is missing. Log in on irembo.gov.rw, copy the Cookie header from an irembo/rest request, and save it as the GitHub secret IREMBO_CITIZEN_COOKIE."
    );
    process.exit(1);
  }
  if (cookieHealth.present && cookieHealth.expired) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "IREMBO_CITIZEN_COOKIE expired. Irembo login lasts about one day. Update the GitHub secret with a fresh Cookie from a logged-in irembo.gov.rw tab, then run Scheduled Scan again.",
        expiresAt: cookieHealth.expiresAt
      })
    );
    process.exit(1);
  }

  const { resumeApplicantSearch } = await import("../services/applicantService.js");
  const resumed = await resumeApplicantSearch();
  const result = await runAutomationTick({ includeScan: false, cronScan: false, force: true });
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
