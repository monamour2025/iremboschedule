import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { enqueueApplicantAutomation } from "../../../../lib/automationQueue.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    if (!body.applicantId) {
      return Response.json({ ok: false, error: "applicantId is required" }, { status: 400 });
    }
    const queueResult = await enqueueApplicantAutomation(body.applicantId);
    return Response.json({ ok: true, queue: queueResult });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
