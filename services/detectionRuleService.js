import {
  deleteDetectionRuleRow,
  insertDetectionRuleRow,
  listDetectionRuleRows,
  listEnabledDetectionRuleRows,
  patchDetectionRuleRow,
  readMonitorSettingsRow,
  writeMonitorSettingsRow
} from "../lib/alertDb.js";
import {
  getTimezone,
  getWindowStatus,
  formatWindowLabel,
  isWithinTimeWindow,
  isValidTimeWindow
} from "../lib/alertWindow.js";
import { renderDetectionMessage } from "../lib/messageTemplate.js";

const SERVER_CHANNELS = ["email", "webhook", "phone"];
const DEFAULT_CATEGORIES = ["A", "A1", "B", "B1", "C", "D", "D1", "E", "F"];

function parseJsonArray(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function serializeJsonArray(value) {
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function normalizeRule(rule) {
  const startHour = Number(rule.startHour);
  const endHour = Number(rule.endHour);
  const windowStatus = getWindowStatus(startHour, endHour);

  return {
    id: Number(rule.id),
    name: rule.name,
    categories: parseJsonArray(rule.categories, ["ALL"]),
    startHour,
    endHour,
    windowLabel: formatWindowLabel(startHour, endHour),
    message: rule.message,
    channels: parseJsonArray(rule.channels, ["email"]),
    enabled: Boolean(rule.enabled),
    activeNow: windowStatus.activeNow,
    windowStatus: windowStatus.label,
    windowDetail: windowStatus.detail,
    createdAt: rule.createdAt instanceof Date ? rule.createdAt.toISOString() : rule.createdAt,
    updatedAt: rule.updatedAt instanceof Date ? rule.updatedAt.toISOString() : rule.updatedAt
  };
}

function normalizeSettings(row) {
  const alertEmail = String(row?.alertEmail || "").trim();
  const alertPhone = String(row?.alertPhone || "").trim();
  const alertWebhookUrl = String(row?.alertWebhookUrl || "").trim();

  return {
    autoNotifyAll: row?.autoNotifyAll !== false,
    alertEmail,
    alertPhone,
    alertWebhookUrl,
    timezone: getTimezone(),
    targets: {
      email: alertEmail || process.env.ALERT_EMAIL || "",
      phone: alertPhone || process.env.ALERT_PHONE || "",
      webhookUrl: alertWebhookUrl || process.env.NOTIFICATION_WEBHOOK_URL || ""
    }
  };
}

export async function getMonitorSettings() {
  const row = await readMonitorSettingsRow();
  return normalizeSettings(row);
}

export async function getNotificationTargets() {
  const settings = await getMonitorSettings();
  return settings.targets;
}

export async function updateMonitorSettings(input) {
  const current = await getMonitorSettings();
  const next = {
    autoNotifyAll:
      input.autoNotifyAll !== undefined ? Boolean(input.autoNotifyAll) : current.autoNotifyAll,
    alertEmail: input.alertEmail !== undefined ? String(input.alertEmail).trim() : current.alertEmail,
    alertPhone: input.alertPhone !== undefined ? String(input.alertPhone).trim() : current.alertPhone,
    alertWebhookUrl:
      input.alertWebhookUrl !== undefined ? String(input.alertWebhookUrl).trim() : current.alertWebhookUrl
  };

  const row = await writeMonitorSettingsRow(next);
  return normalizeSettings(row);
}

export async function listDetectionRules() {
  const rules = await listDetectionRuleRows();
  return rules.map(normalizeRule);
}

export async function listEnabledDetectionRules() {
  const rules = await listEnabledDetectionRuleRows();
  return rules.map(normalizeRule);
}

export async function createDetectionRule(input) {
  const startHour = clampHour(input.startHour);
  const endHour = clampHour(input.endHour);

  if (!isValidTimeWindow(startHour, endHour)) {
    throw new Error("Start and end hour must be different.");
  }

  const rule = await insertDetectionRuleRow({
    name: input.name?.trim() || "Detection window",
    categories: serializeJsonArray(input.categories?.length ? input.categories : ["ALL"]),
    startHour,
    endHour,
    message:
      input.message?.trim() ||
      "Category {category} detected at {center} ({location}) · {slots} slots open",
    channels: serializeJsonArray(sanitizeChannels(input.channels)),
    enabled: input.enabled !== false
  });

  return normalizeRule(rule);
}

export async function updateDetectionRule(id, input) {
  const existing = (await listDetectionRules()).find((rule) => rule.id === Number(id));
  if (!existing) {
    throw new Error("Detection window not found");
  }

  const startHour = input.startHour !== undefined ? clampHour(input.startHour) : existing.startHour;
  const endHour = input.endHour !== undefined ? clampHour(input.endHour) : existing.endHour;

  if (!isValidTimeWindow(startHour, endHour)) {
    throw new Error("Start and end hour must be different.");
  }

  const rule = await patchDetectionRuleRow(Number(id), {
    name: input.name !== undefined ? input.name.trim() || "Detection window" : existing.name,
    categories:
      input.categories !== undefined
        ? serializeJsonArray(input.categories?.length ? input.categories : ["ALL"])
        : serializeJsonArray(existing.categories),
    startHour,
    endHour,
    message: input.message !== undefined ? input.message : existing.message,
    channels:
      input.channels !== undefined
        ? serializeJsonArray(sanitizeChannels(input.channels))
        : serializeJsonArray(existing.channels),
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : existing.enabled
  });

  return normalizeRule(rule);
}

export async function deleteDetectionRule(id) {
  await deleteDetectionRuleRow(Number(id));
  return { ok: true };
}

export function categoryMatchesRule(rule, scheduleCategory) {
  const categories = rule.categories || [];
  if (categories.includes("ALL")) {
    return true;
  }

  return categories.some(
    (category) => String(category).toUpperCase() === String(scheduleCategory || "").toUpperCase()
  );
}

export function getMatchingRules(rules, schedule, date = new Date()) {
  return rules.filter(
    (rule) =>
      rule.enabled &&
      categoryMatchesRule(rule, schedule?.category) &&
      isWithinTimeWindow(date, rule.startHour, rule.endHour)
  );
}

export function buildRuleNotification(rule, schedule) {
  return {
    title: rule.name || "Scheduled detection alert",
    message: renderDetectionMessage(rule.message, schedule),
    channels: sanitizeChannels(rule.channels),
    type: "SCHEDULED_DETECTION"
  };
}

export function getAvailableCategories() {
  return DEFAULT_CATEGORIES;
}

function clampHour(value) {
  const hour = Number(value);
  if (!Number.isFinite(hour)) {
    return 0;
  }
  return Math.min(23, Math.max(0, Math.round(hour)));
}

function sanitizeChannels(channels) {
  const values = Array.isArray(channels) ? channels : ["email"];
  const filtered = values.filter((channel) => SERVER_CHANNELS.includes(channel));
  return filtered.length > 0 ? filtered : ["email"];
}
