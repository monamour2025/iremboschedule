"use client";

import StatusPill from "@/components/StatusPill";
import { formatDate, formatNumber } from "@/lib/format";
import { formatExamCenterLabel } from "@/lib/examCenters";

function BarChart({ items, valueKey = "count", labelKey = "name", emptyLabel }) {
  if (!items?.length) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  const max = Math.max(...items.map((item) => item[valueKey] || 0), 1);

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item[labelKey]}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="truncate font-medium text-slate-800">{item[labelKey]}</span>
            <span className="text-slate-500">{formatNumber(item[valueKey])}</span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-teal-600"
              style={{ width: `${Math.max(8, (item[valueKey] / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryAvailability({ items }) {
  if (!items?.length) {
    return <p className="text-sm text-slate-500">No category data yet.</p>;
  }

  const max = Math.max(...items.map((item) => item.count || 0), 1);

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <article key={item.name} className="rounded-lg border border-slate-100 bg-slate-50/70 p-3">
          <div className="mb-2 flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-slate-900">Category {item.name}</span>
            <span className="text-slate-500">{formatNumber(item.count)} open schedule(s)</span>
          </div>
          <div className="mb-3 h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-teal-600"
              style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }}
            />
          </div>
          {item.sites?.length ? (
            <ul className="space-y-1 text-xs text-slate-600">
              {item.sites.map((site) => (
                <li key={`${item.name}-${site.center}-${site.location}`} className="flex justify-between gap-3">
                  <span className="truncate">
                    {formatExamCenterLabel(site.center)}
                    {site.location ? ` (${site.location})` : ""}
                  </span>
                  <span className="shrink-0 font-medium text-slate-800">{formatNumber(site.count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No open sites detected for this category.</p>
          )}
        </article>
      ))}
    </div>
  );
}

export default function AnalyticsPanel({ analytics }) {
  if (!analytics?.ok) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-950">Analytics</h3>
        <p className="mt-2 text-sm text-slate-600">
          Analytics could not be loaded. Run a scan first, then refresh this page.
        </p>
      </section>
    );
  }

  const { summary, activeLocations, activeCenters, categoryBreakdown, recentDetections, availabilityTrend } =
    analytics;
  const hasData =
    summary.totalSchedules > 0 ||
    summary.changesLast7Days > 0 ||
    activeLocations.length > 0 ||
    recentDetections.length > 0;

  return (
    <section className="space-y-6">
      {!hasData ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          No analytics data yet. Click <strong>Scan now</strong> on the Overview tab — after the first successful
          scan, charts and trends will appear here.
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Available schedules", summary.availableSchedules],
          ["Open slots", summary.totalRemainingSlots],
          ["Detections (7d)", summary.detectionsLast7Days],
          ["Notifications sent", summary.notificationsSent]
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{formatNumber(value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Most active locations</h3>
          <div className="mt-4">
            <BarChart items={activeLocations} emptyLabel="No active locations yet." />
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Most active centers</h3>
          <div className="mt-4">
            <BarChart items={activeCenters} emptyLabel="No active centers yet." />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Category availability</h3>
          <p className="mt-1 text-xs text-slate-500">Open schedules per category and where each category is available.</p>
          <div className="mt-4">
            <CategoryAvailability items={categoryBreakdown} />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">7-day activity trend</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Day</th>
                  <th className="pb-2 pr-4">New</th>
                  <th className="pb-2 pr-4">Capacity +</th>
                  <th className="pb-2">Removed</th>
                </tr>
              </thead>
              <tbody>
                {availabilityTrend.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-4 text-slate-500">
                      No trend data yet.
                    </td>
                  </tr>
                ) : (
                  availabilityTrend.map((row) => (
                    <tr key={row.day} className="border-t border-slate-100">
                      <td className="py-2 pr-4 font-medium text-slate-800">{row.day}</td>
                      <td className="py-2 pr-4 text-slate-600">{row.newSchedules}</td>
                      <td className="py-2 pr-4 text-emerald-700">{row.capacityIncreases}</td>
                      <td className="py-2 text-amber-700">{row.removals}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Recent detections</h3>
          <StatusPill>{recentDetections.length} latest</StatusPill>
        </div>
        <div className="divide-y divide-slate-100">
          {recentDetections.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">No detections in the last 7 days.</p>
          ) : (
            recentDetections.map((detection) => (
              <article key={`${detection.scheduleId}-${detection.detectedAt}`} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone="good">NEW_SCHEDULE</StatusPill>
                  <span className="text-xs text-slate-500">{formatDate(detection.detectedAt)}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  {detection.schedule?.center || "Unknown center"} · {detection.schedule?.location || "Unknown"}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Category {detection.schedule?.category || "-"} · {detection.schedule?.remainingCapacity ?? "-"} slots
                </p>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
