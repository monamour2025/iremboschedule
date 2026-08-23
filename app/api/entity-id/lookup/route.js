import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { logger } from "../../../../lib/logger.js";
import { nationalIdValidationMessage, normalizeNationalIdInput } from "../../../../lib/nationalId.js";
import { prefetchEntityId } from "../../../../services/entityIdService.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const nationalId = normalizeNationalIdInput(body.nationalId);
    const fullName = String(body.fullName || "").trim();
    const validationMessage = nationalIdValidationMessage(nationalId);

    if (validationMessage) {
      return Response.json({ ok: false, error: validationMessage }, { status: 400 });
    }

    const result = await prefetchEntityId({ nationalId, fullName });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    logger.warn("Entity ID prefetch failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 502 }
    );
  }
}
