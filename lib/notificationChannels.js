import axios from "axios";
import { logger } from "./logger.js";
import { buildApplicationCreatedEmail, buildDetectionAlertEmail } from "./emailTemplates.js";

export function resolveTargets(targets = {}) {
  return {
    email: String(targets.email || process.env.ALERT_EMAIL || "").trim(),
    phone: String(targets.phone || process.env.ALERT_PHONE || "").trim(),
    webhookUrl: String(targets.webhookUrl || process.env.NOTIFICATION_WEBHOOK_URL || "").trim()
  };
}

export function getNotificationChannelConfig(targets = {}) {
  const resolved = resolveTargets(targets);

  return {
    email: Boolean(resolved.email),
    webhook: Boolean(resolved.webhookUrl),
    phone: Boolean(resolved.phone),
    browser: true,
    sound: true
  };
}

function buildScheduleMessage(schedule, prefix = "Schedule update") {
  const parts = [
    schedule?.center || "Unknown center",
    schedule?.location ? `(${schedule.location})` : null,
    schedule?.category ? `Category ${schedule.category}` : null,
    schedule?.startDateTime ? new Date(schedule.startDateTime).toLocaleString("en") : null,
    schedule?.remainingCapacity != null
      ? `${schedule.remainingCapacity}/${schedule.maximumCapacity ?? "?"} slots`
      : null
  ].filter(Boolean);

  return `${prefix}: ${parts.join(" · ")}`;
}

export function buildAlertContent({ type, schedule, customMessage }) {
  const title =
    type === "AUTO_DETECTION"
      ? "New schedule detected"
      : type === "NEW_DETECTED_CODES_FOR_BUSANZA_CATEGORY_A"
        ? "Priority slot detected"
        : "Schedule availability update";

  const message = customMessage || buildScheduleMessage(schedule, title);
  return { title, message };
}

async function sendEmail({ title, message, schedule, targets, type, emailMeta }) {
  const resolved = resolveTargets(targets);
  const to = resolved.email;
  if (!to) {
    return { status: "SKIPPED", error: "No alert email configured" };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    let subject = title;
    let text = message;
    let html = `<p><strong>${title}</strong></p><p>${message}</p>`;

    if (type === "APPLICATION_CREATED" && emailMeta) {
      ({ subject, text, html } = buildApplicationCreatedEmail(emailMeta));
    } else if (schedule) {
      ({ subject, text, html } = buildDetectionAlertEmail({ title, message, schedule, type }));
    }

    try {
      await axios.post(
        "https://api.resend.com/emails",
        {
          from: process.env.RESEND_FROM || "onboarding@resend.dev",
          to: [to],
          subject,
          text,
          html
        },
        {
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json"
          },
          timeout: 10000
        }
      );
      return { status: "SENT" };
    } catch (error) {
      const apiMessage =
        error?.response?.data?.message ||
        error?.response?.data?.error ||
        (Array.isArray(error?.response?.data?.errors)
          ? error.response.data.errors.map((row) => row.message).join("; ")
          : null);
      throw new Error(apiMessage || error.message);
    }
  }

  if (resolved.webhookUrl) {
    await axios.post(
      resolved.webhookUrl,
      {
        channel: "email",
        title,
        message,
        targets: { email: to },
        schedule
      },
      { timeout: 10000 }
    );
    return { status: "SENT" };
  }

  return { status: "SKIPPED", error: "Add a webhook URL or RESEND_API_KEY to deliver email alerts" };
}

async function sendWebhook(payload, targets) {
  const resolved = resolveTargets(targets);
  if (!resolved.webhookUrl) {
    return { status: "SKIPPED", error: "Webhook URL is not configured" };
  }

  await axios.post(
    resolved.webhookUrl,
    {
      ...payload,
      targets: {
        email: resolved.email,
        phone: resolved.phone
      }
    },
    { timeout: 10000 }
  );

  return { status: "SENT" };
}

async function sendPhone(payload, targets) {
  const resolved = resolveTargets(targets);
  const phone = resolved.phone;
  if (!phone) {
    return { status: "SKIPPED", error: "No alert phone configured" };
  }

  if (!resolved.webhookUrl) {
    return { status: "SKIPPED", error: "Add a webhook URL to deliver phone alerts" };
  }

  await axios.post(
    resolved.webhookUrl,
    {
      channel: "phone",
      callReady: true,
      targets: { phone },
      ...payload
    },
    { timeout: 10000 }
  );

  return { status: "SENT" };
}

export async function dispatchToChannels({
  channels,
  title,
  message,
  type,
  schedule,
  customMessage,
  targets,
  emailMeta
}) {
  const resolvedTargets = resolveTargets(targets);
  const content = buildAlertContent({ type, schedule, customMessage });
  const finalTitle = title || content.title;
  const finalMessage = message || content.message;
  const payload = {
    type,
    title: finalTitle,
    message: finalMessage,
    schedule,
    preparedAt: new Date().toISOString()
  };

  const results = [];

  for (const channel of channels) {
    try {
      let result;
      if (channel === "email") {
        result = await sendEmail({
          title: finalTitle,
          message: finalMessage,
          schedule,
          targets: resolvedTargets,
          type,
          emailMeta
        });
      } else if (channel === "webhook") {
        result = await sendWebhook(payload, resolvedTargets);
      } else if (channel === "phone") {
        result = await sendPhone(payload, resolvedTargets);
      } else if (channel === "browser" || channel === "sound") {
        result = { status: "CLIENT" };
      } else {
        result = { status: "SKIPPED", error: `Unknown channel: ${channel}` };
      }

      results.push({ channel, ...result });
    } catch (error) {
      logger.error("Notification channel failed", { channel, message: error.message });
      results.push({ channel, status: "FAILED", error: error.message });
    }
  }

  return results;
}

export function getDefaultServerChannels(targets = {}) {
  const resolved = resolveTargets(targets);
  const channels = [];

  if (resolved.email) {
    channels.push("email");
  }
  if (resolved.webhookUrl) {
    channels.push("webhook");
  }
  if (resolved.phone && resolved.webhookUrl) {
    channels.push("phone");
  }

  return channels;
}
