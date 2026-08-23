import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";
import { getDefaultScheduleCategories, getScheduleCategories } from "../../../../providers/iremboApplicationProvider.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  try {
    assertAdminAccess(request);
    try {
      const categories = await getScheduleCategories();
      return Response.json({ ok: true, categories, source: "irembo" });
    } catch (error) {
      logger.warn("Schedule categories fetch failed; using defaults", { message: error.message });
      return Response.json({
        ok: true,
        categories: getDefaultScheduleCategories(),
        source: "fallback",
        warning: error.message
      });
    }
  } catch (error) {
    logger.error("Schedule categories request failed", { message: error.message });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
