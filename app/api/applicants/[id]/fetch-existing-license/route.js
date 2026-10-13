import { assertAdminAccess } from "../../../../../lib/automationConfig.js";
import { logger } from "../../../../../lib/logger.js";
import {
  assertRequestedCategoryAllowed,
  fetchAndPersistExistingLicense
} from "../../../../../services/existingLicenseService.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  const { id } = await params;
  try {
    assertAdminAccess(request);
    const body = await request.json().catch(() => ({}));
    const requestedLicenseCategory = body.requestedLicenseCategory
      ? String(body.requestedLicenseCategory).trim()
      : null;

    const result = await fetchAndPersistExistingLicense(id);
    if (requestedLicenseCategory) {
      try {
        assertRequestedCategoryAllowed(result.applicant.existingLicenseCategories, requestedLicenseCategory);
      } catch {
        // Licence details still loaded; category choice is validated on save.
      }
    }

    return Response.json(result);
  } catch (error) {
    logger.error("Applicant existing licence fetch failed", { message: error.message, applicantId: id });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
