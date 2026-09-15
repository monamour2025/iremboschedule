export const OFFICE_NOTIFICATION_EMAIL = "ishamiprohub@gmail.com";

export function getOfficeNotificationEmail() {
  const configured = String(process.env.ALERT_EMAIL || "").trim();
  if (configured && configured.toLowerCase() !== "niyomuhozajeandedieu80@gmail.com") {
    return configured;
  }
  return OFFICE_NOTIFICATION_EMAIL;
}

export function resolveNotificationEmail(preferred = "") {
  const requested = String(preferred || "").trim();
  if (requested) {
    return requested;
  }
  return getOfficeNotificationEmail();
}
