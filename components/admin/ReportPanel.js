"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import { downloadAutomationReportPdf } from "@/lib/reportPdf";
import {
  IconAlertCircle,
  IconCheckCircle,
  IconClock,
  IconDownload,
  IconRefresh,
  IconUserPlus,
  IconUsers
} from "@/components/admin/AdminIcons";
import { formatStatusLabel, statusTone } from "@/components/admin/applicantUi";

const VIEWS = [
  { id: "successful", label: "Successful", Icon: IconCheckCircle },
  { id: "new", label: "New", Icon: IconUserPlus },
  { id: "recent", label: "Recent", Icon: IconClock }
];

function formatDisplayDate(value) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Kigali",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function StatCard({ icon: IconComponent, label, value, tone = "slate" }) {
  const tones = {
    teal: "border-teal-200 bg-teal-50 text-teal-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    slate: "border-slate-200 bg-white text-slate-900"
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${tones[tone] || tones.slate}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
        </div>
        <div className="rounded-lg bg-white/70 p-2">
          <IconComponent className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function ApplicantReportTable({ rows, emptyMessage, showUpdated = false }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Name</th>
            <th className="px-4 py-3">Phone</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3">Exam slot</th>
            <th className="px-4 py-3">Kode yo kwishyura</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Added</th>
            {showUpdated ? <th className="px-4 py-3">Last updated</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={showUpdated ? 8 : 7} className="px-4 py-8 text-center text-slate-500">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <div className="font-medium">{row.fullName}</div>
                  {row.isNew ? (
                    <span className="mt-1 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                      New
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div>{row.phone}</div>
                  <div className="text-xs text-slate-500">{row.email || "-"}</div>
                </td>
                <td className="px-4 py-3">{row.licenseCategory}</td>
                <td className="px-4 py-3">{row.examSlot}</td>
                <td className="px-4 py-3 font-mono text-xs font-semibold text-teal-800">
                  {row.paymentCode}
                </td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${statusTone(row.status)}`}>
                    {formatStatusLabel(row.status, row.applicationNumber)}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{formatDisplayDate(row.createdAt)}</td>
                {showUpdated ? (
                  <td className="px-4 py-3 text-slate-600">{formatDisplayDate(row.updatedAt)}</td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportPanel() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState("successful");

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await adminFetch("/api/admin/report");
      setReport(payload.report);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const activeRows = useMemo(() => {
    if (!report) {
      return [];
    }
    if (view === "new") {
      return report.newApplicants;
    }
    if (view === "recent") {
      return report.recentApplicants;
    }
    return report.successfulApplicants;
  }, [report, view]);

  const viewMeta = useMemo(() => {
    if (view === "new") {
      return {
        title: "New applicants",
        description: `Added in the last ${report?.windows?.newApplicantDays || 7} days, newest first.`,
        emptyMessage: "No new applicants in this period."
      };
    }
    if (view === "recent") {
      return {
        title: "Recent applicants",
        description: `Last ${report?.windows?.recentApplicantLimit || 30} updates across all statuses.`,
        emptyMessage: "No recent applicant activity yet."
      };
    }
    return {
      title: "Successful applications",
      description: "Submitted applications with a payment code (Kode yo kwishyura).",
      emptyMessage: "No successful applications yet."
    };
  }, [report, view]);

  async function handleDownloadPdf() {
    if (!report) {
      return;
    }
    setDownloading(true);
    try {
      await downloadAutomationReportPdf(report);
    } catch (downloadError) {
      setError(downloadError.message || "Could not generate PDF.");
    } finally {
      setDownloading(false);
    }
  }

  const categoryBreakdown = Object.entries(report?.summary?.byCategory || {});
  const hasPdfRows =
    (report?.successfulApplicants?.length || 0) +
      (report?.newApplicants?.length || 0) +
      (report?.recentApplicants?.length || 0) >
    0;

  return (
    <AdminShell
      title="Report"
      description="Successful applications, new and recent applicants, plus PDF export."
      onSecretSaved={loadReport}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {report?.generatedAt ? `Last updated ${formatDisplayDate(report.generatedAt)}` : "Loading report..."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadReport}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            <IconRefresh className="h-4 w-4" />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={!report || downloading || !hasPdfRows}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            <IconDownload className="h-4 w-4" />
            {downloading ? "Preparing PDF..." : "Download PDF"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      {loading && !report ? (
        <p className="mt-6 text-sm text-slate-500">Loading report data...</p>
      ) : null}

      {report ? (
        <>
          <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              icon={IconUsers}
              label="Total applicants"
              value={report.summary.totalApplicants}
              tone="slate"
            />
            <StatCard
              icon={IconUserPlus}
              label={`New (${report.windows.newApplicantDays}d)`}
              value={report.summary.newApplicants}
              tone="teal"
            />
            <StatCard
              icon={IconClock}
              label="Recent updates"
              value={report.summary.recentApplicants}
              tone="slate"
            />
            <StatCard
              icon={IconCheckCircle}
              label="Successful"
              value={report.summary.successfulApplications}
              tone="emerald"
            />
            <StatCard
              icon={IconAlertCircle}
              label="Failed"
              value={report.summary.failed}
              tone="rose"
            />
          </section>

          {categoryBreakdown.length > 0 ? (
            <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-900">Successful by category</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {categoryBreakdown.map(([category, count]) => (
                  <span
                    key={category}
                    className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800"
                  >
                    Category {category}: {count}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">{viewMeta.title}</h2>
                  <p className="mt-1 text-sm text-slate-600">{viewMeta.description}</p>
                </div>
                <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
                  {VIEWS.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setView(id)}
                      className={
                        view === id
                          ? "inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-teal-800 shadow-sm"
                          : "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
                      }
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                      {id === "new" ? (
                        <span className="rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-800">
                          {report.summary.newApplicants}
                        </span>
                      ) : null}
                      {id === "recent" ? (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold text-slate-700">
                          {report.summary.recentApplicants}
                        </span>
                      ) : null}
                      {id === "successful" ? (
                        <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                          {report.summary.successfulApplications}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <ApplicantReportTable
              rows={activeRows}
              emptyMessage={viewMeta.emptyMessage}
              showUpdated={view === "recent"}
            />
          </section>
        </>
      ) : null}
    </AdminShell>
  );
}
