import { getStatus } from "../../../services/monitorService.js";
import { getScanRunnerState, runForegroundScan, startBackgroundScan } from "../../../lib/scanRunner.js";
import { logger } from "../../../lib/logger.js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  try {
    const [status, runner] = await Promise.all([getStatus(), Promise.resolve(getScanRunnerState())]);
    return Response.json({
      ok: true,
      ...runner,
      lastScanAt: status.lastScanAt
    });
  } catch (error) {
    logger.error("Scan status request failed", { message: error.message });
    return Response.json({ ok: false, error: "SCAN_STATUS_FAILED" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const scanSecret = String(process.env.SCAN_API_SECRET || "").trim();
    // Only enforce when explicitly configured. Empty/whitespace must not block Scan now.
    if (scanSecret) {
      const providedSecret = String(request.headers.get("x-scan-secret") || "").trim();
      if (providedSecret !== scanSecret) {
        return Response.json(
          {
            ok: false,
            error: "UNAUTHORIZED",
            message: "Set x-scan-secret header or remove SCAN_API_SECRET for dashboard scans."
          },
          { status: 401 }
        );
      }
    }

    const body = await request.json().catch(() => ({}));

    // Vercel serverless cannot keep working after the response; run the scan in-request.
    if (process.env.VERCEL) {
      const result = await runForegroundScan(body);
      return Response.json(result);
    }

    const result = startBackgroundScan(body);
    return Response.json(result);
  } catch (error) {
    logger.error("Scan failed", { message: error.message });
    return Response.json(
      {
        ok: false,
        error: "SCAN_FAILED",
        message: error.message
      },
      { status: 500 }
    );
  }
}
