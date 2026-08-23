import { assertAdminAccess } from "../../../../../lib/automationConfig.js";
import { logger } from "../../../../../lib/logger.js";
import { getApplicantById, setApplicantEntityId } from "../../../../../services/applicantService.js";
import { prefetchEntityId } from "../../../../../services/entityIdService.js";
import { enqueueApplicantAutomation } from "../../../../../lib/automationQueue.js";

export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    assertAdminAccess(request);
    const params = await context.params;
    const applicant = await getApplicantById(params.id, true);
    if (!applicant) {
      return Response.json({ ok: false, error: "Applicant not found." }, { status: 404 });
    }

    const result = await prefetchEntityId({
      nationalId: applicant.nationalIdFull,
      fullName: applicant.fullName
    });

    await setApplicantEntityId(params.id, result.entityId);
    const refreshed = await getApplicantById(params.id, true);
    await enqueueApplicantAutomation(params.id, { force: true });

    return Response.json({
      ok: true,
      entityId: result.entityId,
      displayName: result.displayName,
      source: result.source,
      applicant: refreshed,
      queued: true
    });
  } catch (error) {
    logger.warn("Resolve profile failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 502 }
    );
  }
}
