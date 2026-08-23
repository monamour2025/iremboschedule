import Dashboard from "@/components/Dashboard";
import { getAnalyticsSummary } from "@/services/analyticsService.js";
import { getStatus, listChanges, listSchedules } from "@/services/monitorService.js";
import { getNotificationSettings, listNotifications } from "@/services/notificationService.js";
import {
  getMonitorSettings,
  listDetectionRules,
  getAvailableCategories
} from "@/services/detectionRuleService.js";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [status, schedules, changes, analytics, notificationsPayload, detectionPayload] = await Promise.all([
    getStatus().catch(() => ({ ok: false, status: "DATABASE_NOT_READY" })),
    listSchedules({ availableOnly: true, limit: 3000 }).catch(() => []),
    listChanges(100).catch(() => []),
    getAnalyticsSummary().catch(() => ({ ok: false })),
    Promise.all([
      listNotifications(30).catch(() => []),
      getNotificationSettings().catch(() => ({ channels: {}, defaults: [], targets: {}, monitor: { autoNotifyAll: true } }))
    ]).then(([notifications, settings]) => ({ notifications, settings })),
    Promise.all([
      listDetectionRules().catch(() => []),
      getMonitorSettings().catch(() => ({ autoNotifyAll: true, timezone: "Africa/Kigali" })),
      Promise.resolve(getAvailableCategories())
    ]).then(([rules, settings, categories]) => ({ rules, settings, categories }))
  ]);

  return (
    <Dashboard
      initialStatus={status}
      initialSchedules={schedules}
      initialChanges={changes}
      initialAnalytics={analytics}
      initialNotifications={notificationsPayload.notifications}
      initialNotificationSettings={notificationsPayload.settings}
      initialDetectionRules={detectionPayload.rules}
      initialMonitorSettings={detectionPayload.settings}
      initialDetectionCategories={detectionPayload.categories}
    />
  );
}
