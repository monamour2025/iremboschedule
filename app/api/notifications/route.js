import { listNotifications, getNotificationSettings } from "../../../services/notificationService.js";
import { logger } from "../../../lib/logger.js";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 50);

    return Response.json({
      ok: true,
      settings: await getNotificationSettings(),
      notifications: await listNotifications(Number.isFinite(limit) ? limit : 50)
    });
  } catch (error) {
    logger.error("Notifications request failed", { message: error.message });
    return Response.json({ ok: false, error: "NOTIFICATIONS_FAILED" }, { status: 500 });
  }
}
