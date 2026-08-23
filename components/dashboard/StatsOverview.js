"use client";

import StatusPill from "@/components/StatusPill";
import { formatDate, formatNumber } from "@/lib/format";

export default function StatsOverview({
  status,
  scheduleCount,
  remainingSlots,
  isFetching,
  isScanning,
  onScanNow
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">Live metrics from the latest monitor scan.</p>
        <button
          type="button"
          disabled={isScanning}
          onClick={onScanNow}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isScanning ? "Scanning..." : "Scan now"}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["System status", <StatusPill key="status" tone={status?.ok ? "good" : "warn"}>{status?.status || "Unknown"}</StatusPill>],
          ["Last scan", formatDate(status?.lastScanAt)],
          ["Open schedules", formatNumber(scheduleCount)],
          ["Remaining slots", formatNumber(remainingSlots)],
          ["Live refresh", isFetching ? "Updating..." : "Every 15 seconds"]
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <div className="mt-2 text-lg font-semibold text-slate-950">{value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
