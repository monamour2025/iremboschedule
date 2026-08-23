"use client";

import { useEffect, useMemo, useState } from "react";
import StatusPill from "@/components/StatusPill";
import { messageTemplateHint } from "@/lib/messageTemplate";
import { isValidTimeWindow } from "@/lib/alertWindow";

const serverChannelOptions = [
  ["email", "Email"],
  ["webhook", "Webhook"],
  ["phone", "Phone"]
];

const emptyRule = {
  name: "Night watch",
  categories: ["A"],
  startHour: 22,
  endHour: 6,
  message: "Night alert: Category {category} at {center} ({location}) · {slots} slots open",
  channels: ["email", "webhook"],
  enabled: true
};

export default function DetectionSchedulesPanel({
  rules,
  settings,
  categories,
  onSaveSettings,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  saving
}) {
  const [draft, setDraft] = useState(emptyRule);
  const [editingId, setEditingId] = useState(null);
  const [contacts, setContacts] = useState({
    alertEmail: settings?.alertEmail || "",
    alertPhone: settings?.alertPhone || "",
    alertWebhookUrl: settings?.alertWebhookUrl || ""
  });
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setContacts({
      alertEmail: settings?.alertEmail || "",
      alertPhone: settings?.alertPhone || "",
      alertWebhookUrl: settings?.alertWebhookUrl || ""
    });
  }, [settings?.alertEmail, settings?.alertPhone, settings?.alertWebhookUrl]);

  const hourOptions = useMemo(
    () => Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: `${String(hour).padStart(2, "0")}:00` })),
    []
  );

  function resetDraft() {
    setDraft(emptyRule);
    setEditingId(null);
    setFormError("");
  }

  function startEdit(rule) {
    setEditingId(rule.id);
    setDraft({
      name: rule.name,
      categories: rule.categories,
      startHour: rule.startHour,
      endHour: rule.endHour,
      message: rule.message,
      channels: rule.channels,
      enabled: rule.enabled
    });
    setFormError("");
  }

  function toggleCategory(category) {
    setDraft((current) => {
      const hasAll = current.categories.includes("ALL");
      if (category === "ALL") {
        return { ...current, categories: hasAll ? [] : ["ALL"] };
      }

      const withoutAll = current.categories.filter((item) => item !== "ALL");
      const next = withoutAll.includes(category)
        ? withoutAll.filter((item) => item !== category)
        : [...withoutAll, category];

      return { ...current, categories: next.length > 0 ? next : ["ALL"] };
    });
  }

  function toggleChannel(channel) {
    setDraft((current) => ({
      ...current,
      channels: current.channels.includes(channel)
        ? current.channels.filter((item) => item !== channel)
        : [...current.channels, channel]
    }));
  }

  async function handleContactsSubmit(event) {
    event.preventDefault();
    setFormError("");
    try {
      await onSaveSettings({
        autoNotifyAll: settings?.autoNotifyAll,
        alertEmail: contacts.alertEmail,
        alertPhone: contacts.alertPhone,
        alertWebhookUrl: contacts.alertWebhookUrl
      });
    } catch (error) {
      setFormError(error.message || "Failed to save contact details");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError("");

    if (!isValidTimeWindow(draft.startHour, draft.endHour)) {
      setFormError("Start and end hour must be different. The window is only active between those hours.");
      return;
    }

    const payload = {
      ...draft,
      categories: draft.categories.length > 0 ? draft.categories : ["ALL"],
      channels: draft.channels.length > 0 ? draft.channels : ["email"]
    };

    try {
      if (editingId) {
        await onUpdateRule(editingId, payload);
      } else {
        await onCreateRule(payload);
      }
      resetDraft();
    } catch (error) {
      setFormError(error.message || "Failed to save detection window");
    }
  }

  return (
    <section className="space-y-6">
      <form onSubmit={handleContactsSubmit} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">Alert contacts</h3>
        <p className="mt-1 text-sm text-slate-600">
          Set email, phone, and webhook URL for detection alerts. Saved here in the dashboard.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">
            Email
            <input
              type="email"
              value={contacts.alertEmail}
              onChange={(event) => setContacts({ ...contacts, alertEmail: event.target.value })}
              placeholder="you@example.com"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Phone
            <input
              type="tel"
              value={contacts.alertPhone}
              onChange={(event) => setContacts({ ...contacts, alertPhone: event.target.value })}
              placeholder="+250..."
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-slate-800 lg:col-span-2">
            Webhook URL
            <input
              type="url"
              value={contacts.alertWebhookUrl}
              onChange={(event) => setContacts({ ...contacts, alertWebhookUrl: event.target.value })}
              placeholder="https://your-service.com/alerts"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save contacts"}
        </button>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-base font-semibold text-slate-950">Automatic detection alerts</h3>
            <p className="mt-1 text-sm text-slate-600">
              When enabled, any detected category sends an alert immediately using your saved contacts.
            </p>
          </div>
          <label className="inline-flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
            <input
              type="checkbox"
              checked={Boolean(settings?.autoNotifyAll)}
              disabled={saving}
              onChange={async (event) => {
                try {
                  await onSaveSettings({
                    autoNotifyAll: event.target.checked,
                    alertEmail: contacts.alertEmail,
                    alertPhone: contacts.alertPhone,
                    alertWebhookUrl: contacts.alertWebhookUrl
                  });
                } catch (error) {
                  setFormError(error.message || "Failed to update auto-notify setting");
                }
              }}
            />
            Notify on any category detection
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Timezone: {settings?.timezone || "Africa/Kigali"}. Detection windows only fire inside their hours, then
          expire until the next window.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-teal-950">
              {editingId ? "Edit detection window" : "Add detection window"}
            </h3>
            <p className="mt-1 text-sm text-teal-900">
              Alerts only send between the start and end hour. Outside that range the window is inactive.
            </p>
          </div>
          {editingId ? (
            <button
              type="button"
              onClick={resetDraft}
              className="text-sm font-medium text-teal-800 hover:text-teal-950"
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        {formError ? <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{formError}</p> : null}

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">
            Name
            <input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className="mt-1 h-10 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm"
              placeholder="Night watch"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-slate-800">
              Start hour
              <select
                value={draft.startHour}
                onChange={(event) => setDraft({ ...draft, startHour: Number(event.target.value) })}
                className="mt-1 h-10 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm"
              >
                {hourOptions.map((option) => (
                  <option key={`start-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium text-slate-800">
              End hour
              <select
                value={draft.endHour}
                onChange={(event) => setDraft({ ...draft, endHour: Number(event.target.value) })}
                className="mt-1 h-10 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm"
              >
                {hourOptions.map((option) => (
                  <option key={`end-${option.value}`} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-sm font-medium text-slate-800">Categories</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {["ALL", ...categories].map((category) => (
              <label
                key={category}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  draft.categories.includes(category)
                    ? "border-teal-700 bg-white text-teal-900"
                    : "border-teal-200 bg-white/70 text-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={draft.categories.includes(category)}
                  onChange={() => toggleCategory(category)}
                />
                {category === "ALL" ? "All categories" : `Category ${category}`}
              </label>
            ))}
          </div>
        </div>

        <label className="mt-4 block text-sm font-medium text-slate-800">
          Message
          <textarea
            value={draft.message}
            onChange={(event) => setDraft({ ...draft, message: event.target.value })}
            className="mt-1 min-h-24 w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-xs text-slate-500">{messageTemplateHint}</span>
        </label>

        <div className="mt-4">
          <p className="text-sm font-medium text-slate-800">Channels</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {serverChannelOptions.map(([channel, label]) => (
              <label key={channel} className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.channels.includes(channel)}
                  onChange={() => toggleChannel(channel)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : editingId ? "Update window" : "Add window"}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() =>
              setDraft({
                ...emptyRule,
                name: "Night watch",
                startHour: 22,
                endHour: 6
              })
            }
            className="inline-flex h-10 items-center justify-center rounded-lg border border-teal-700 bg-white px-4 text-sm font-semibold text-teal-800"
          >
            Use night preset
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">Detection windows</h3>
        <div className="mt-4 space-y-3">
          {rules.length === 0 ? (
            <p className="text-sm text-slate-500">
              No scheduled windows yet. Add one to get custom night alerts for specific categories.
            </p>
          ) : (
            rules.map((rule) => (
              <article key={rule.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-sm font-semibold text-slate-950">{rule.name}</h4>
                      <StatusPill tone={rule.activeNow ? "good" : "neutral"}>{rule.windowStatus}</StatusPill>
                      <StatusPill>{rule.windowLabel}</StatusPill>
                      {!rule.enabled ? <StatusPill tone="warn">Disabled</StatusPill> : null}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">{rule.windowDetail}</p>
                    <p className="mt-2 text-sm text-slate-700">
                      Categories:{" "}
                      {rule.categories.includes("ALL")
                        ? "All"
                        : rule.categories.map((category) => `Category ${category}`).join(", ")}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{rule.message}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rule.channels.map((channel) => (
                        <StatusPill key={`${rule.id}-${channel}`}>{channel}</StatusPill>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onUpdateRule(rule.id, { enabled: !rule.enabled })}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                    >
                      {rule.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      type="button"
                      onClick={() => startEdit(rule)}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteRule(rule.id)}
                      className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
