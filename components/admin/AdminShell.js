"use client";

import AdminAccessPanel from "@/components/admin/AdminAccessPanel";

export default function AdminShell({ children, title, description, onSecretSaved }) {
  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="animate-fade-up overflow-hidden rounded-2xl border border-red-100 bg-white shadow-sm">
          <div className="bg-gradient-to-r from-red-700 via-red-600 to-rose-500 px-5 py-4 text-white">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-red-100">Estimate list</p>
                <h1 className="mt-1 text-2xl font-semibold">{title}</h1>
                {description ? <p className="mt-1 text-sm text-red-50">{description}</p> : null}
              </div>
              <div className="rounded-xl bg-white/95 p-2 text-slate-900 shadow-sm">
                <AdminAccessPanel compact onSaved={onSecretSaved} />
              </div>
            </div>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}
