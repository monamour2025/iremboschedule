import {
  createDetectionRule,
  deleteDetectionRule,
  getAvailableCategories,
  getMonitorSettings,
  listDetectionRules,
  updateDetectionRule,
  updateMonitorSettings
} from "../../../services/detectionRuleService.js";
import { getNotificationChannelConfig } from "../../../lib/notificationChannels.js";
import { logger } from "../../../lib/logger.js";

export async function GET() {
  try {
    const [settings, rules, categories] = await Promise.all([
      getMonitorSettings(),
      listDetectionRules(),
      Promise.resolve(getAvailableCategories())
    ]);

    return Response.json({
      ok: true,
      settings,
      rules,
      categories
    });
  } catch (error) {
    logger.error("Detection rules request failed", { message: error.message });
    return Response.json({ ok: false, error: "DETECTION_RULES_FAILED", message: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();

    if (body.action === "updateSettings") {
      const settings = await updateMonitorSettings({
        autoNotifyAll: body.autoNotifyAll,
        alertEmail: body.alertEmail,
        alertPhone: body.alertPhone,
        alertWebhookUrl: body.alertWebhookUrl
      });
      return Response.json({
        ok: true,
        settings,
        channels: getNotificationChannelConfig(settings.targets)
      });
    }

    const rule = await createDetectionRule(body);
    return Response.json({ ok: true, rule });
  } catch (error) {
    logger.error("Detection rule create failed", { message: error.message });
    return Response.json({ ok: false, error: "DETECTION_RULE_CREATE_FAILED", message: error.message }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    if (!body.id) {
      return Response.json({ ok: false, error: "MISSING_RULE_ID" }, { status: 400 });
    }

    const rule = await updateDetectionRule(body.id, body);
    return Response.json({ ok: true, rule });
  } catch (error) {
    logger.error("Detection rule update failed", { message: error.message });
    return Response.json({ ok: false, error: "DETECTION_RULE_UPDATE_FAILED", message: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return Response.json({ ok: false, error: "MISSING_RULE_ID" }, { status: 400 });
    }

    await deleteDetectionRule(id);
    return Response.json({ ok: true });
  } catch (error) {
    logger.error("Detection rule delete failed", { message: error.message });
    return Response.json({ ok: false, error: "DETECTION_RULE_DELETE_FAILED", message: error.message }, { status: 500 });
  }
}
