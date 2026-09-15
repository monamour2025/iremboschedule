import { dispatchToChannels, getDefaultServerChannels } from "../lib/notificationChannels.js";
import { getOfficeNotificationEmail } from "../lib/notificationInbox.js";
import { getNotificationTargets } from "../services/detectionRuleService.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/db.js";

async function persistApplicationNotifications(title, message, results) {
  if (!results?.length) {
    return;
  }

  try {
    await prisma.notification.createMany({
      data: results.map((result) => ({
        channel: result.channel,
        type: "APPLICATION_CREATED",
        title,
        message,
        payload: JSON.stringify({ result }),
        status: result.status,
        error: result.error || null
      }))
    });
  } catch (error) {
    logger.warn("Could not save application notification history", { message: error.message });
  }
}

export async function sendApplicationCreatedNotification({
  email,
  phone,
  fullName,
  applicationNumber,
  status,
  examCenter,
  location,
  examDate,
  examTime,
  category
}) {
  const paymentCode = String(applicationNumber || "").trim();
  const siteLine = [examCenter, location].filter(Boolean).join(" · ");
  const slotLine = [examDate, examTime].filter(Boolean).join(" ");
  const title = paymentCode ? `Kode yo kwishyura · ${paymentCode}` : "Driving license application created";
  const message = [
    `Muraho ${fullName}, dosiye yawe yoherejwe neza kuri Irembo.`,
    "",
    `Kode yo kwishyura: ${paymentCode}`,
    category ? `Category: ${category}` : null,
    siteLine ? `Ikigo / Site: ${siteLine}` : null,
    slotLine ? `Igihe / Time: ${slotLine}` : null,
    "",
    `Status: ${status}`,
    "",
    "Wishyura kuri Irembo ukoresheje iyi kode."
  ]
    .filter((line) => line !== null)
    .join("\n");

  try {
    const targets = await getNotificationTargets().catch(() => ({
      email: getOfficeNotificationEmail(),
      phone: phone || "",
      webhookUrl: process.env.NOTIFICATION_WEBHOOK_URL || ""
    }));
    const officeEmail = targets.email || getOfficeNotificationEmail();

    const channels = getDefaultServerChannels({
      email: officeEmail,
      phone: phone || targets.phone,
      webhookUrl: targets.webhookUrl
    });

    if (channels.length === 0) {
      logger.warn("No notification channels configured for application success alert");
      return;
    }

    const results = await dispatchToChannels({
      channels,
      title,
      message,
      type: "APPLICATION_CREATED",
      emailMeta: {
        fullName,
        applicationNumber,
        status,
        examCenter,
        location,
        examDate,
        examTime,
        category
      },
      targets: {
        email: officeEmail,
        phone: phone || targets.phone,
        webhookUrl: targets.webhookUrl
      }
    });
    await persistApplicationNotifications(title, message, results);
  } catch (error) {
    logger.error("Failed to send application created notification", { message: error.message });
  }
}
