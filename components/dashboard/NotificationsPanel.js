"use client";

import StatusPill from "@/components/StatusPill";
import { formatDate } from "@/lib/format";

const channelLabels = {
  browser: "Browser",
  sound: "Sound",
  email: "Email",
  webhook: "Webhook",
  phone: "Phone"
};

function getChannelStatus(key, settings) {
  if (key === "browser" || key === "sound") {
    return { configured: true, label: "Available" };
  }

  const targets = settings?.targets || {};

  if (key === "email") {
    return targets.email
      ? { configured: true, label: `Configured · ${targets.email}` }
      : { configured: false, label: "Add email in Alert contacts" };
  }

  if (key === "webhook") {
    return targets.webhookUrl
      ? { configured: true, label: "Configured" }
      : { configured: false, label: "Add webhook URL in Alert contacts" };
  }

  if (key === "phone") {
    return targets.phone
      ? { configured: true, label: `Configured · ${targets.phone}` }
      : { configured: false, label: "Add phone in Alert contacts" };
  }

  return {
    configured: Boolean(settings?.channels?.[key]),
    label: settings?.channels?.[key] ? "Available" : "Not configured"
  };
}

export default function NotificationPreferences({ settings, prefs, onChange, onEnableBrowser }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-950">Client notification preferences</h3>
          <p className="mt-1 text-sm text-slate-600">
            Browser and sound alerts on this device. Email, webhook, and phone use your saved Alert contacts above.
          </p>
        </div>
        <button
          type="button"
          onClick={onEnableBrowser}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-teal-700 bg-teal-700 px-4 text-sm font-semibold text-white transition hover:bg-teal-800"
        >
          Enable browser alerts
        </button>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(channelLabels).map(([key, label]) => {
          const status = getChannelStatus(key, settings);
          return (
            <label
              key={key}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                status.configured ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"
              }`}
            >
              <input
                type="checkbox"
                checked={Boolean(prefs[key])}
                onChange={(event) => onChange({ ...prefs, [key]: event.target.checked })}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">{label}</span>
                <span className="mt-1 block text-xs text-slate-500">{status.label}</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function NotificationsPanel({ notifications, settings }) {
  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">Delivery history</h3>
        <p className="mt-1 text-sm text-slate-600">
          Schedule alerts and application-created emails (after successful automation).
        </p>
        <div className="mt-4 divide-y divide-slate-100">
          {notifications.length === 0 ? (
            <p className="py-6 text-sm text-slate-500">No notifications sent yet.</p>
          ) : (
            notifications.map((notification) => (
              <article key={notification.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={notification.status === "SENT" ? "good" : "warn"}>
                    {notification.channel}
                  </StatusPill>
                  <StatusPill>{notification.status}</StatusPill>
                  <span className="text-xs text-slate-500">{formatDate(notification.createdAt)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">{notification.title}</p>
                <p className="mt-1 text-sm text-slate-600">{notification.message}</p>
                {notification.error ? (
                  <p className="mt-1 text-xs text-amber-700">{notification.error}</p>
                ) : null}
              </article>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Active channels</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(channelLabels).map(([channel, label]) => {
            const status = getChannelStatus(channel, settings);
            if (channel === "browser" || channel === "sound") {
              return null;
            }
            return (
              <StatusPill key={channel} tone={status.configured ? "good" : "neutral"}>
                {label}
              </StatusPill>
            );
          })}
        </div>
      </div>
    </section>
  );
}
