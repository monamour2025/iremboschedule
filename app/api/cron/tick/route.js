import { assertCronAccess } from "../../../../lib/cronAuth.js";
import { runAutomationTick } from "../../../../lib/automationTick.js";
import { logger } from "../../../../lib/logger.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request) {
  try {
    assertCronAccess(request);
    process.env.IREMBO_EXPAND_TIME_SLOTS = "false";
    const result = await runAutomationTick({ includeScan: true, cronScan: true });
    logger.info("Cron tick completed", {
      scanned: result.scanned,
      scanOk: result.scan?.ok,
      waitingOk: result.waiting?.ok,
      pendingOk: result.pending?.ok
    });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error("Cron tick failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 500 }
    );
  }
}
