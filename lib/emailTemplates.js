function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatDateTime(value) {
  if (!value) {
    return "Not specified";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not specified";
  }
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: process.env.IREMBO_TIMEZONE || "Africa/Kigali",
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatSlots(schedule) {
  const remaining = schedule?.remainingCapacity;
  const maximum = schedule?.maximumCapacity;
  if (remaining == null) {
    return "Available";
  }
  if (maximum != null) {
    return `${remaining} of ${maximum} open`;
  }
  return `${remaining} open`;
}

function emailShell({ preheader, badge, headline, intro, bodyRows, footerNote }) {
  const preheaderText = escapeHtml(preheader);
  const rows = bodyRows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 0;color:#64748b;font-size:13px;width:120px;vertical-align:top;">${escapeHtml(label)}</td>
          <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(headline)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheaderText}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 12px;background:linear-gradient(135deg,#0f766e,#115e59);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Irembo Schedule Monitor</div>
                <div style="margin-top:10px;display:inline-block;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.16);font-size:12px;font-weight:600;">${escapeHtml(badge)}</div>
                <h1 style="margin:14px 0 8px;font-size:24px;line-height:1.3;font-weight:700;">${escapeHtml(headline)}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;opacity:0.92;">${escapeHtml(intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 24px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e2e8f0;">
                  ${rows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px 28px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">${escapeHtml(footerNote)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detectionBadge(type) {
  if (type === "NEW_DETECTED_CODES_FOR_BUSANZA_CATEGORY_A") {
    return "Priority match";
  }
  if (type === "SCHEDULED_DETECTION") {
    return "Scheduled alert";
  }
  if (type === "AUTO_DETECTION") {
    return "New slot detected";
  }
  return "Availability update";
}

export function buildDetectionAlertEmail({ title, message, schedule, type }) {
  const category = schedule?.category || "Unknown";
  const center = schedule?.center || "Unknown center";
  const location = schedule?.location || "Unknown district";
  const badge = detectionBadge(type);
  const subject = `Exam slot available · Category ${category} · ${center}`;
  const text = [
    badge,
    "",
    message || title,
    "",
    `Category: ${category}`,
    `Center: ${center}`,
    `District: ${location}`,
    `Exam time: ${formatDateTime(schedule?.startDateTime)}`,
    `Slots: ${formatSlots(schedule)}`,
    "",
    "Sent by your Irembo schedule monitor."
  ].join("\n");

  const html = emailShell({
    preheader: `${category} at ${center} · ${formatSlots(schedule)}`,
    badge,
    headline: title || "A new exam slot is available",
    intro: message || "The monitor found an open driving test slot that matches your watch settings.",
    bodyRows: [
      ["Category", `Category ${category}`],
      ["Center", center],
      ["District", location],
      ["Exam time", formatDateTime(schedule?.startDateTime)],
      ["Open slots", formatSlots(schedule)]
    ],
    footerNote: "You received this because schedule monitoring is enabled on your account."
  });

  return { subject, text, html };
}

export function buildApplicationCreatedEmail({ fullName, applicationNumber, status }) {
  const paymentCode = String(applicationNumber || "").trim();
  const subject = paymentCode
    ? `Kode yo kwishyura · ${paymentCode}`
    : "Application created · driving license test";
  const text = [
    `Muraho ${fullName},`,
    "",
    "Dosiye yawe yoherejwe neza kuri Irembo.",
    "",
    `Kode yo kwishyura: ${paymentCode}`,
    `Payment code: ${paymentCode}`,
    "",
    `Application number: ${paymentCode}`,
    `Status: ${status}`,
    "",
    "Wishyure kuri Irembo ukoresheje iyi kode. / Complete payment on Irembo using this code."
  ].join("\n");

  const html = emailShell({
    preheader: paymentCode ? `Kode yo kwishyura: ${paymentCode}` : "Application submitted successfully.",
    badge: "Dosiye yoherejwe",
    headline: "Kode yo kwishyura",
    intro: `Muraho ${fullName}, dosiye yawe yoherejwe neza kuri Irembo. Koresha iyi kode wishyure.`,
    bodyRows: [
      ["Kode yo kwishyura", paymentCode],
      ["Payment code", paymentCode],
      ["Application no.", paymentCode],
      ["Status", status],
      ["Next step", "Wishyura kuri Irembo / Pay on Irembo"]
    ],
    footerNote:
      "Iyi kode ni imwe niyo Irembo yohereza kuri telefoni. Niba utabonye imeri ya Irembo, koresha iyi kode wishyure."
  });

  return { subject, text, html };
}
