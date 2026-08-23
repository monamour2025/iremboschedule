"use client";

import { useEffect, useState } from "react";
import { getAdminSecret, setAdminSecret } from "@/lib/adminFetch";

export default function AdminAccessPanel({ onSaved, compact = false }) {
  const [adminSecret, setAdminSecretState] = useState("");
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const existing = getAdminSecret();
    setAdminSecretState(existing);
    setSaved(Boolean(existing));
    setOpen(!existing);
  }, []);

  function handleSave() {
    setAdminSecret(adminSecret);
    setSaved(Boolean(adminSecret.trim()));
    setOpen(false);
    onSaved?.();
  }

  if (compact && saved && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
      >
        Admin connected
      </button>
    );
  }

  if (compact) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="font-medium text-slate-800">Admin secret</span>
            <input
              type="password"
              value={adminSecret}
              onChange={(event) => setAdminSecretState(event.target.value)}
              placeholder="Same as ADMIN_API_SECRET in .env"
              className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-3 text-sm"
            />
          </label>
          <div className="flex gap-2">
            {saved ? (
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-10 rounded-lg border border-slate-300 px-4 text-sm font-medium"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleSave}
              className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Admin secret</h2>
      <p className="mt-1 text-sm text-slate-600">
        Enter the same value as <code className="rounded bg-slate-100 px-1">ADMIN_API_SECRET</code> in your{" "}
        <code className="rounded bg-slate-100 px-1">.env</code> file, then restart the server.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <input
          type="password"
          value={adminSecret}
          onChange={(event) => setAdminSecretState(event.target.value)}
          placeholder="ADMIN_API_SECRET"
          className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <button
          type="button"
          onClick={handleSave}
          className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white"
        >
          Save secret
        </button>
      </div>
    </section>
  );
}
