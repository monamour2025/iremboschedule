import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { listApplicants } from "../../../../services/applicantService.js";
import { buildAutomationReport } from "../../../../services/reportService.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    const report = await buildAutomationReport(listApplicants);
    return Response.json({ ok: true, report });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
