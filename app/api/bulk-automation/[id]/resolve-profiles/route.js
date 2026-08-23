import { assertAdminAccess } from "../../../../../lib/automationConfig.js";
import { logger } from "../../../../../lib/logger.js";
import { prisma } from "../../../../../lib/db.js";
import { decryptNationalId } from "../../../../../lib/encryption.js";
import { getApplicantById, setApplicantEntityId } from "../../../../../services/applicantService.js";
import { prefetchEntityId } from "../../../../../services/entityIdService.js";

export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    assertAdminAccess(request);
    const params = await context.params;
    const batchId = Number(params.id);
    const applicants = await prisma.applicant.findMany({
      where: { batchId },
      orderBy: { createdAt: "asc" }
    });

    const results = [];
    for (const applicant of applicants) {
      if (applicant.entityId) {
        results.push({ id: applicant.id, fullName: applicant.fullName, ok: true, source: "stored" });
        continue;
      }

      try {
        const nationalId = decryptNationalId(applicant.nationalIdEnc);
        const resolved = await prefetchEntityId({ nationalId, fullName: applicant.fullName });
        await setApplicantEntityId(applicant.id, resolved.entityId);
        results.push({
          id: applicant.id,
          fullName: applicant.fullName,
          ok: true,
          source: resolved.source
        });
      } catch (error) {
        results.push({
          id: applicant.id,
          fullName: applicant.fullName,
          ok: false,
          error: error.message
        });
      }
    }

    const failed = results.filter((row) => !row.ok);
    return Response.json({
      ok: failed.length === 0,
      count: results.length,
      linked: results.filter((row) => row.ok).length,
      failed: failed.length,
      results
    });
  } catch (error) {
    logger.warn("Batch profile resolve failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 502 }
    );
  }
}
