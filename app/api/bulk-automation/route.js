import { assertAdminAccess } from "../../../lib/automationConfig.js";
import { logger } from "../../../lib/logger.js";
import { listAutomationBatchesDetailed, saveDraftBatch } from "../../../services/bulkAutomationService.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    return Response.json({ ok: true, batches: await listAutomationBatchesDetailed() });
  } catch (error) {
    logger.error("Bulk automation list failed", { message: error.message });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const result = await saveDraftBatch({
      name: body.name,
      batchId: body.batchId || null,
      applicants: body.applicants || [],
      autoStart: body.autoStart === true || body.listMode === "estimate"
    });
    return Response.json({ ok: true, ...result }, { status: 201 });
  } catch (error) {
    logger.error("Bulk automation create failed", { message: error.message });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
