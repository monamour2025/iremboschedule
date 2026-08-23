"use client";

import { useEffect, useState } from "react";
import AdminShell from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/adminFetch";

function formatStatusLabel(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "PAYMENT_EXPIRED") return "Expired on Irembo";
  if (normalized === "PAYMENT_PENDING") return "Payment pending";
  if (normalized === "PAID") return "Paid";
  if (normalized === "PAYMENT_CANCELLED") return "Cancelled";
  if (normalized === "COMPLETED") return "Completed";
  if (normalized === "PENDING") return "Pending";
  if (normalized === "FAILED") return "Failed";
  return normalized.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function statusClassName(status) {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "PAYMENT_EXPIRED" || normalized === "PAYMENT_CANCELLED" || normalized === "FAILED") {
    return "font-medium text-amber-800";
  }
  if (normalized === "PAYMENT_PENDING") {
    return "font-medium text-blue-700";
  }
  if (normalized === "PAID" || normalized === "COMPLETED") {
    return "font-medium text-emerald-700";
  }
  return "text-slate-700";
}

export default function ApplicationsTable() {
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  async function loadApplications({ silent = false } = {}) {
    if (!silent) {
      setSyncing(true);
    }
    try {
      const payload = await adminFetch("/api/applications");
      setApplications(payload.applications || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  }

  useEffect(() => {
    loadApplications();
    const interval = setInterval(() => loadApplications({ silent: true }), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AdminShell
      title="Applications"
      description="Application codes synced from Irembo payment status (expired codes are marked expired)."
      onSecretSaved={() => loadApplications()}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Status comes from Irembo, not only from local storage.
          {syncing ? " Syncing…" : ""}
        </p>
        <button
          type="button"
          onClick={() => loadApplications()}
          disabled={syncing}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          {syncing ? "Refreshing…" : "Refresh from Irembo"}
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Application Number</th>
                <th className="px-4 py-3">Irembo Status</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
                    Loading and syncing with Irembo…
                  </td>
                </tr>
              ) : applications.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-4 py-8 text-center text-slate-500">
                    No applications yet.
                  </td>
                </tr>
              ) : (
                applications.map((application) => (
                  <tr key={application.id}>
                    <td className="px-4 py-3 font-medium">{application.applicantName || "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{application.applicationNumber || "-"}</td>
                    <td className={`px-4 py-3 ${statusClassName(application.status)}`}>
                      {formatStatusLabel(application.status)}
                      {application.iremboSynced === false && application.syncError ? (
                        <span className="mt-1 block text-xs font-normal text-slate-500">
                          Sync failed: {application.syncError}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {application.paymentExpiresAt
                        ? new Date(application.paymentExpiresAt).toLocaleString()
                        : "-"}
                    </td>
                    <td className="px-4 py-3">{application.amount ?? "-"}</td>
                    <td className="px-4 py-3">{new Date(application.createdAt).toLocaleString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
