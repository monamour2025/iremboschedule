import { listSchedules, listCategorySlotsForPicker } from "../../../services/monitorService.js";
import { logger } from "../../../lib/logger.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const availableOnly = searchParams.get("availableOnly") !== "false";
    const limit = Number(searchParams.get("limit") || process.env.SCHEDULES_API_LIMIT || 3000);
    const location = searchParams.get("location") || undefined;
    const category = searchParams.get("category") || undefined;
    const center = searchParams.get("center") || undefined;
    const forPicker = searchParams.get("forPicker") === "true";

    const schedules =
      forPicker && category
        ? await listCategorySlotsForPicker(category, { availableOnly, limit, location, center })
        : await listSchedules({ availableOnly, limit, location, category, center });

    return Response.json({
      ok: true,
      schedules
    });
  } catch (error) {
    logger.error("Schedules request failed", { message: error.message });
    return Response.json({ ok: false, error: "SCHEDULES_FAILED" }, { status: 500 });
  }
}
