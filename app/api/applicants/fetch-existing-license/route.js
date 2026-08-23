import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";
import { nationalIdValidationMessage, normalizeNationalIdInput } from "../../../../lib/nationalId.js";
import { assertRequestedCategoryAllowed, fetchExistingLicenseForNationalId } from "../../../../services/existingLicenseService.js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const nationalId = normalizeNationalIdInput(body.nationalId);
    const fullName = String(body.fullName || "").trim();
    const requestedLicenseCategory = body.requestedLicenseCategory
      ? String(body.requestedLicenseCategory).trim()
      : null;

    const validationMessage = nationalIdValidationMessage(nationalId);
    if (validationMessage) {
      return Response.json({ ok: false, error: validationMessage }, { status: 400 });
    }

    const result = await fetchExistingLicenseForNationalId({ nationalId, fullName });
    if (requestedLicenseCategory) {
      assertRequestedCategoryAllowed(result.existingLicense.categories, requestedLicenseCategory);
    }

    return Response.json({
      ok: true,
      success: true,
      entityId: result.entityId,
      fullName: result.fullName,
      existingLicense: result.existingLicense
    });
  } catch (error) {
    logger.error("Existing licence lookup failed", { message: error.message });
    const message = String(error.message || "");
    const friendlyMessage = message.includes("getExistingDrivingLicense timed out")
      ? "Irembo licence lookup timed out. Wait a moment and try again, or check that schedule scans are not overloading the server."
      : message;
    return Response.json({ ok: false, error: friendlyMessage }, { status: error.statusCode || 500 });
  }
}
