import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";
import { getExamSitesForCategory } from "../../../../services/examSitesService.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request) {
  try {
    assertAdminAccess(request);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") || "";
    const includeOffices = searchParams.get("full") === "true";
    const result = await getExamSitesForCategory(category, { includeOffices });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.error("Exam sites request failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message, sites: [] },
      { status: error.statusCode || 500 }
    );
  }
}
