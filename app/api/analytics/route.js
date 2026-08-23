import { getAnalyticsSummary } from "../../../services/analyticsService.js";
import { logger } from "../../../lib/logger.js";

export async function GET() {
  try {
    return Response.json(await getAnalyticsSummary());
  } catch (error) {
    logger.error("Analytics request failed", { message: error.message });
    return Response.json({ ok: false, error: "ANALYTICS_FAILED" }, { status: 500 });
  }
}
