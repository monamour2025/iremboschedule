import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import {
  buildAlertContent,
  dispatchToChannels,
  getDefaultServerChannels,
  getNotificationChannelConfig
} from "../lib/notificationChannels.js";
import {
  buildRuleNotification,
  getMatchingRules,
  getMonitorSettings,
  getNotificationTargets,
  listEnabledDetectionRules
} from "./detectionRuleService.js";

function parseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isNotifiableChange(change, schedule) {
  if (!schedule || Number(schedule.remainingCapacity || 0) <= 0) {
    return false;
  }

  return ["NEW_SCHEDULE", "CAPACITY_INCREASE"].includes(change.type);
}

async function persistNotificationResults({ scheduleId, type, title, message, schedule, results, ruleId = null }) {
  if (results.length === 0) {
    return [];
  }

  await prisma.notification.createMany({
    data: results.map((result) => ({
      scheduleId: scheduleId || null,
      channel: result.channel,
      type,
      title,
      message,
      payload: JSON.stringify({ schedule, result, ruleId }),
      status: result.status,
      error: result.error || null
    }))
  });

  return results;
}

async function deliverNotification({
  scheduleId,
  schedule,
  type,
  title,
  message,
  channels,
  ruleId = null,
  targets
}) {
  const selectedChannels = (channels || []).filter((channel) => channel !== "browser" && channel !== "sound");
  if (selectedChannels.length === 0) {
    return { status: "SKIPPED", results: [], error: "No server channels selected" };
  }

  const results = await dispatchToChannels({
    channels: selectedChannels,
    type,
    schedule,
    title,
    message,
    targets
  });

  await persistNotificationResults({
    scheduleId,
    type,
    title,
    message,
    schedule,
    results,
    ruleId: type === "SCHEDULED_DETECTION" ? ruleId : null
  });

  const status = results.some((result) => result.status === "SENT")
    ? "SENT"
    : results.every((result) => result.status === "SKIPPED")
      ? "SKIPPED"
      : "FAILED";

  return { status, results };
}

export async function sendNotification({
  scheduleId,
  schedule,
  type = "MANUAL_ALERT",
  title,
  message,
  channels,
  customMessage
}) {
  const targets = await getNotificationTargets();
  const selectedChannels = channels?.length ? channels : getDefaultServerChannels(targets);
  const content = buildAlertContent({ type, schedule, customMessage });
  const finalTitle = title || content.title;
  const finalMessage = message || content.message;

  const delivery = await deliverNotification({
    scheduleId,
    schedule,
    type,
    title: finalTitle,
    message: finalMessage,
    channels: selectedChannels,
    targets
  });

  return {
    ok: delivery.status !== "FAILED",
    title: finalTitle,
    message: finalMessage,
    channels: selectedChannels,
    results: delivery.results,
    status: delivery.status
  };
}

export async function listNotifications(limit = 50) {
  await ensureDatabaseSchema();
  return prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: limit
  });
}

export async function getNotificationSettings() {
  const monitorSettings = await getMonitorSettings();

  return {
    channels: getNotificationChannelConfig(monitorSettings.targets),
    defaults: getDefaultServerChannels(monitorSettings.targets),
    targets: monitorSettings.targets,
    monitor: monitorSettings
  };
}

export async function prepareNotifications(changes, latestSchedules = []) {
  const latestById = new Map(latestSchedules.map((schedule) => [schedule.scheduleId, schedule]));
  const [monitorSettings, enabledRules, targets] = await Promise.all([
    getMonitorSettings(),
    listEnabledDetectionRules(),
    getNotificationTargets()
  ]);
  const defaultChannels = getDefaultServerChannels(targets);
  const notifications = [];
  const now = new Date();

  for (const change of changes) {
    const schedule = latestById.get(change.scheduleId) || parseJson(change.newValue);
    if (!isNotifiableChange(change, schedule)) {
      continue;
    }

    const matchingRules = getMatchingRules(enabledRules, schedule, now);
    let delivered = false;

    for (const rule of matchingRules) {
      const ruleNotification = buildRuleNotification(rule, schedule);
      const entry = {
        scheduleId: change.scheduleId,
        ruleId: rule.id,
        type: ruleNotification.type,
        changeType: change.type,
        schedule,
        title: ruleNotification.title,
        message: ruleNotification.message,
        preparedAt: now.toISOString(),
        status: "PENDING"
      };

      try {
        const delivery = await deliverNotification({
          scheduleId: change.scheduleId,
          schedule,
          type: ruleNotification.type,
          title: ruleNotification.title,
          message: ruleNotification.message,
          channels: ruleNotification.channels,
          ruleId: rule.id,
          targets
        });
        entry.status = delivery.status;
        entry.results = delivery.results;
        if (delivery.status === "SENT") {
          delivered = true;
        }
      } catch (error) {
        entry.status = "FAILED";
        entry.error = error.message;
        logger.error("Scheduled detection notification failed", {
          scheduleId: change.scheduleId,
          ruleId: rule.id,
          message: error.message
        });
      }

      notifications.push(entry);
    }

    const shouldAutoNotify =
      monitorSettings.autoNotifyAll && matchingRules.length === 0 && defaultChannels.length > 0;

    if (shouldAutoNotify) {
      const content = buildAlertContent({
        type: change.type === "NEW_SCHEDULE" ? "AUTO_DETECTION" : change.type,
        schedule
      });
      const entry = {
        scheduleId: change.scheduleId,
        type: "AUTO_DETECTION",
        changeType: change.type,
        schedule,
        title: content.title,
        message: content.message,
        preparedAt: now.toISOString(),
        status: "PENDING"
      };

      try {
        const delivery = await deliverNotification({
          scheduleId: change.scheduleId,
          schedule,
          type: "AUTO_DETECTION",
          title: content.title,
          message: content.message,
          channels: defaultChannels,
          targets
        });
        entry.status = delivery.status;
        entry.results = delivery.results;
        if (delivery.status === "SENT") {
          delivered = true;
        }
      } catch (error) {
        entry.status = "FAILED";
        entry.error = error.message;
        logger.error("Automatic detection notification failed", {
          scheduleId: change.scheduleId,
          message: error.message
        });
      }

      notifications.push(entry);
    } else if (!delivered && matchingRules.length === 0 && defaultChannels.length === 0) {
      notifications.push({
        scheduleId: change.scheduleId,
        type: change.type,
        changeType: change.type,
        schedule,
        preparedAt: now.toISOString(),
        status: monitorSettings.autoNotifyAll ? "PENDING_CHANNEL_CONFIG" : "OUTSIDE_RULE_WINDOW"
      });
    }
  }

  if (notifications.length > 0) {
    logger.info("Prepared schedule change notifications", {
      count: notifications.length,
      sentCount: notifications.filter((entry) => entry.status === "SENT").length,
      ruleCount: enabledRules.length
    });
  }

  return {
    notifications,
    priorityNotifications: notifications.filter((entry) => entry.status === "SENT")
  };
}
