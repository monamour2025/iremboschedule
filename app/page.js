import Dashboard from "@/components/Dashboard";
import { ensureDatabaseSchema } from "@/lib/ensureSchema.js";
import { logger } from "@/lib/logger.js";
import { getAnalyticsSummary } from "@/services/analyticsService.js";
import { getStatus, listChanges, listSchedules } from "@/services/monitorService.js";
import { getNotificationSettings, listNotifications } from "@/services/notificationService.js";
import {
  getMonitorSettings,
  listDetectionRules,
  getAvailableCategories
} from "@/services/detectionRuleService.js";

export const dynamic = "force-dynamic";

function logHomeLoadError(label, error) {
  logger.error(`Homepage ${label} failed`, {
    message: error?.message || String(error),
    code: error?.code || null
  });
}

export default async function Home() {
  try {
    await ensureDatabaseSchema();
  } catch (error) {
    logHomeLoadError("schema", error);
    return (
      <Dashboard
        initialStatus={{ ok: false, status: "DATABASE_NOT_READY" }}
        initialSchedules={[]}
        initialChanges={[]}
        initialAnalytics={{ ok: false }}
        initialNotifications={[]}
        initialNotificationSettings={{ channels: {}, defaults: [], targets: {}, monitor: { autoNotifyAll: true } }}
        initialDetectionRules={[]}
        initialMonitorSettings={{ autoNotifyAll: true, timezone: "Africa/Kigali" }}
        initialDetectionCategories={[]}
      />
    );
  }

  const [status, schedules, changes, analytics, notificationsPayload, detectionPayload] = await Promise.all([
    getStatus().catch((error) => {
      logHomeLoadError("status", error);
      return { ok: false, status: "DATABASE_NOT_READY" };
    }),
    listSchedules({ availableOnly: true, limit: 3000 }).catch((error) => {
      logHomeLoadError("schedules", error);
      return [];
    }),
    listChanges(100).catch((error) => {
      logHomeLoadError("changes", error);
      return [];
    }),
    getAnalyticsSummary().catch((error) => {
      logHomeLoadError("analytics", error);
      return { ok: false };
    }),
    Promise.all([
      listNotifications(30).catch((error) => {
        logHomeLoadError("notifications", error);
        return [];
      }),
      getNotificationSettings().catch((error) => {
        logHomeLoadError("notificationSettings", error);
        return { channels: {}, defaults: [], targets: {}, monitor: { autoNotifyAll: true } };
      })
    ]).then(([notifications, settings]) => ({ notifications, settings })),
    Promise.all([
      listDetectionRules().catch((error) => {
        logHomeLoadError("detectionRules", error);
        return [];
      }),
      getMonitorSettings().catch((error) => {
        logHomeLoadError("monitorSettings", error);
        return { autoNotifyAll: true, timezone: "Africa/Kigali" };
      }),
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
