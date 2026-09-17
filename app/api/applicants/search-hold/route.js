import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";
import {
  pauseApplicantSearch,
  pauseRestAndKeepTestApplicants,
  resumeApplicantSearch
} from "../../../../services/applicantService.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const action = String(body.action || "").trim();

    if (action === "pauseRest") {
      const result = await pauseRestAndKeepTestApplicants({
        keepIds: body.keepIds || [],
        keepCount: body.keepCount || 5
      });
      return Response.json({ ok: true, ...result });
    }
    if (action === "pause") {
      const result = await pauseApplicantSearch(body.applicantIds || body.ids || []);
      return Response.json({ ok: true, ...result });
    }
    if (action === "resume" || action === "resumeAll") {
      const ids = action === "resumeAll" ? null : body.applicantIds || body.ids || [];
      const result = await resumeApplicantSearch(ids);
      return Response.json({ ok: true, ...result });
    }

    return Response.json({ ok: false, error: "Unknown search-hold action." }, { status: 400 });
  } catch (error) {
    logger.error("Applicant search-hold failed", { message: error.message });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
