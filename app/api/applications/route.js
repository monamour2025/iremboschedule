import { assertAdminAccess } from "../../../lib/automationConfig.js";
import { listApplications } from "../../../services/applicationService.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    return Response.json({ ok: true, applications: await listApplications() });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
