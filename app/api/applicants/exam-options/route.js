import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";
import { getExamFormOptions } from "../../../../services/examOptionsService.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    const { searchParams } = new URL(request.url);
    const options = await getExamFormOptions({
      category: searchParams.get("category") || undefined,
      location: searchParams.get("location") || undefined,
      center: searchParams.get("center") || undefined,
      date: searchParams.get("date") || undefined
    });

    return Response.json({ ok: true, ...options });
  } catch (error) {
    logger.error("Exam options request failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 500 }
    );
  }
}
