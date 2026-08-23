"use client";

import StatusPill from "@/components/StatusPill";
import { formatDate } from "@/lib/format";

export default function ScheduleSection({
  scheduleFilter,
  onScheduleFilterChange,
  scheduleRows,
  schedules,
  changes
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Schedules</h2>
          <p className="mt-1 text-sm text-slate-500">
            Browse open slots and recent changes. Alerts are sent automatically when the system detects them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {[
            ["active", "Current", schedules.length],
            ["changed", "Changed", changes.filter((change) => change.type !== "REMOVED_SCHEDULE").length],
            ["removed", "Removed", changes.filter((change) => change.type === "REMOVED_SCHEDULE").length]
          ].map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              onClick={() => onScheduleFilterChange(value)}
              className={`h-9 rounded-lg px-3 text-sm font-medium transition ${
                scheduleFilter === value ? "bg-teal-700 text-white" : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {label} {count}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Center</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">Capacity</th>
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3">Detected</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {scheduleRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-slate-500" colSpan="7">
                    No rows for this filter.
                  </td>
                </tr>
              ) : (
                scheduleRows.map((schedule) => (
                  <tr key={schedule.rowKey || schedule.scheduleId} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{schedule.center || "Unknown"}</td>
                    <td className="px-4 py-3 text-slate-600">{schedule.location || "Unknown"}</td>
                    <td className="px-4 py-3 text-slate-600">{schedule.category || "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDate(schedule.startDateTime)}</td>
                    <td className="px-4 py-3 text-slate-900">
                      {schedule.remainingCapacity ?? "-"} / {schedule.maximumCapacity ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={schedule.rowType === "REMOVED" ? "warn" : "neutral"}>
                        {schedule.rowType}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {formatDate(schedule.firstDetectedAt || schedule.lastSeen)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
