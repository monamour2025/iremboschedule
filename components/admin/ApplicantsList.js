"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EstimatePeopleBoard, { estimateProgress } from "@/components/admin/EstimatePeopleBoard";
import { adminFetch } from "@/lib/adminFetch";

function requestedCategory(applicant) {
  return String(applicant?.requestedLicenseCategory || applicant?.licenseCategory || "").trim().toUpperCase();
}

export default function ApplicantsList() {
  const [applicants, setApplicants] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadApplicants(silent = false) {
    if (!silent) {
      setLoading(true);
    }
    try {
      const payload = await adminFetch("/api/applicants");
      setApplicants(payload.applicants || []);
      if (!silent) {
        setError("");
      }
    } catch (loadError) {
      if (!silent) {
        setError(loadError.message);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadApplicants();
    const timer = setInterval(() => loadApplicants(true), 8000);
    return () => clearInterval(timer);
  }, []);

  const categories = useMemo(() => {
    const values = new Set(applicants.map(requestedCategory).filter(Boolean));
    return [...values].sort();
  }, [applicants]);

  const visible = useMemo(() => {
    if (categoryFilter === "ALL") {
      return applicants;
    }
    return applicants.filter((row) => requestedCategory(row) === categoryFilter);
  }, [applicants, categoryFilter]);

  const waitingCount = applicants.filter((row) => estimateProgress(row).key === "waiting").length;
  const createdCount = applicants.filter((row) => estimateProgress(row).key === "created").length;

  async function handleResumeAll() {
    setHoldBusy(true);
    setError("");
    try {
      const payload = await adminFetch("/api/applicants/search-hold", {
        method: "POST",
        body: JSON.stringify({ action: "resumeAll" })
      });
      setSuccess(`Searching again for ${payload.resumed || 0} people.`);
      await loadApplicants();
    } catch (holdError) {
      setError(holdError.message);
    } finally {
      setHoldBusy(false);
    }
  }

  async function handleRetry(applicant) {
    setError("");
    try {
      if (applicant.searchPaused) {
        await adminFetch("/api/applicants/search-hold", {
          method: "POST",
          body: JSON.stringify({ action: "resume", ids: [applicant.id] })
        });
        setSuccess(`${applicant.fullName} is searching again.`);
      } else {
        await adminFetch(`/api/applicants/${applicant.id}`, {
          method: "POST",
          body: JSON.stringify({ action: "retry" })
        });
        setSuccess(`${applicant.fullName}: retrying the requested category.`);
      }
      await loadApplicants();
    } catch (retryError) {
      setError(retryError.message);
    }
  }

  async function handleRemove(applicant) {
    if (!window.confirm(`Remove ${applicant.fullName} from the queue?`)) {
      return;
    }
    setError("");
    try {
      await adminFetch(`/api/applicants/${applicant.id}`, { method: "DELETE" });
      setSuccess(`${applicant.fullName} removed.`);
      await loadApplicants();
    } catch (removeError) {
      setError(removeError.message);
    }
  }

  return (
    <AdminShell
      title="Queue"
      description="The system watches Irembo for the exact category each person requested — Category B people only get Category B codes."
      onSecretSaved={() => loadApplicants()}
    >
      <section className="animate-fade-up rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-700">
          Save people on the Estimate list. GitHub scan looks for open Busanza seats. When Category{" "}
          <span className="font-semibold text-red-800">B</span> is open, only people who requested B are booked.
          A, C, D sit until their own category opens. Wrong-category seats are never assigned.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-900 ring-1 ring-red-100">
            {waitingCount} waiting
          </p>
          <p className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-100">
            {createdCount} codes created
          </p>
          <Link
            href="/admin/bulk"
            className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50"
          >
            Add people
          </Link>
          <button
            type="button"
            onClick={handleResumeAll}
            disabled={holdBusy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {holdBusy ? "Resuming..." : "Resume all searches"}
          </button>
        </div>
        {categories.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryFilter("ALL")}
              className={
                categoryFilter === "ALL"
                  ? "rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
                  : "rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-800"
              }
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setCategoryFilter(category)}
                className={
                  categoryFilter === category
                    ? "rounded-full bg-red-600 px-3 py-1 text-xs font-semibold text-white"
                    : "rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-800"
                }
              >
                Category {category}
              </button>
            ))}
          </div>
        ) : null}
        {error ? <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">{error}</p> : null}
        {success ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</p>
        ) : null}
        {loading && applicants.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Loading queue...</p>
        ) : null}
      </section>

      <EstimatePeopleBoard
        applicants={visible}
        title="People in queue"
        description={`${visible.length} shown · progress updates automatically`}
        emptyMessage="Nobody in this view. Add people on the Estimate list, then come back here."
        onRefresh={() => loadApplicants()}
        onRemove={handleRemove}
        onRetry={handleRetry}
      />
    </AdminShell>
  );
}
