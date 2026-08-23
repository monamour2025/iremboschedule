import { assertAdminAccess } from "../../../../../lib/automationConfig.js";
import { logger } from "../../../../../lib/logger.js";
import { cancelAutomationBatch } from "../../../../../services/bulkAutomationService.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    assertAdminAccess(request);
    const batch = await cancelAutomationBatch(params.id);
    return Response.json({ ok: true, batch });
  } catch (error) {
    logger.error("Bulk automation cancel failed", { message: error.message, batchId: params.id });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
