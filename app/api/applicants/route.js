import { assertAdminAccess } from "../../../lib/automationConfig.js";
import { logger } from "../../../lib/logger.js";
import { createApplicant, listAutomationQueueApplicants } from "../../../services/applicantService.js";
import { assignScheduleFromMonitor } from "../../../services/applicantMatchingService.js";
import { enqueueApplicantAutomation } from "../../../lib/automationQueue.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    return Response.json({ ok: true, applicants: await listAutomationQueueApplicants() });
  } catch (error) {
    logger.error("Applicants list failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 500 }
    );
  }
}

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const applicant = await createApplicant(body);
    await assignScheduleFromMonitor(applicant.id, body.selectedScheduleId);
    await enqueueApplicantAutomation(applicant.id, { force: true });
    const refreshed = (await listAutomationQueueApplicants()).find((row) => row.id === applicant.id);
    return Response.json({ ok: true, applicant: refreshed || applicant, queued: true }, { status: 201 });
  } catch (error) {
    logger.error("Applicant create failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 500 }
    );
  }
}
