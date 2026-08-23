import { assertAdminAccess } from "../../../../../lib/automationConfig.js";
import { logger } from "../../../../../lib/logger.js";
import {
  assertRequestedCategoryAllowed,
  fetchAndPersistExistingLicense
} from "../../../../../services/existingLicenseService.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    assertAdminAccess(request);
    const body = await request.json().catch(() => ({}));
    const requestedLicenseCategory = body.requestedLicenseCategory
      ? String(body.requestedLicenseCategory).trim()
      : null;

    const result = await fetchAndPersistExistingLicense(params.id);
    if (requestedLicenseCategory) {
      assertRequestedCategoryAllowed(result.applicant.existingLicenseCategories, requestedLicenseCategory);
    }

    return Response.json(result);
  } catch (error) {
    logger.error("Applicant existing licence fetch failed", { message: error.message, applicantId: params.id });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
