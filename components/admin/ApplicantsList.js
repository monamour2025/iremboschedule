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
  const [editingId, setEditingId] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

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
    const timer = setInterval(() => loadApplicants(true), 3000);
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

  async function handleEditCategory(applicant, patch) {
    if (!patch) {
      setEditingId(applicant.id);
      return;
    }
    const category = String(patch.category || "").trim().toUpperCase();
    const phone = String(patch.phone || "").trim();
    setEditBusy(true);
    setError("");
    try {
      const payload = await adminFetch(`/api/applicants/${applicant.id}`, {
        method: "POST",
        body: JSON.stringify({ action: "setCategory", licenseCategory: category, phone })
      });
      if (payload.applicant) {
        setApplicants((current) =>
          current.map((row) => (row.id === payload.applicant.id ? { ...row, ...payload.applicant } : row))
        );
      }
      const created = ["APPLICATION_CREATED", "COMPLETED", "PAYMENT_PENDING", "PAID"].includes(
        payload.applicant?.status
      );
      const matched = Number(payload.matched || 0);
      setSuccess(
        created
          ? `${payload.applicant.fullName}: application ${payload.applicant.applicationNumber || "created"}.`
          : matched > 0
            ? `${applicant.fullName}: Category ${category} seats found. Creating the application…`
            : `${applicant.fullName} is Category ${category}. No live ${category} seats yet — watching.`
      );
      setEditingId(null);
    } catch (editError) {
      setError(editError.message);
    } finally {
      setEditBusy(false);
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
      description="When the category you selected has a future open Busanza sitting, the application is created automatically — same path for A, B, B(AT), C, D, D1, E, and F."
      onSecretSaved={() => loadApplicants()}
    >
      <section className="animate-fade-up rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-700">
          Save people on the Estimate list and pick their category. Edit can move someone back (for example
          NTWARI from B to A). The scanner keeps running. When that exact category has a future open sitting
          at Busanza, the application is created. Category A is booked alongside the others — A seats are
          not skipped for B.
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
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            Add
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
        description={`${visible.length} shown · Edit changes category (use B to test) · Delete removes the person`}
        emptyMessage="Nobody in this view. Click Add, then come back here."
        onRefresh={() => loadApplicants()}
        onRemove={handleRemove}
        onRetry={handleRetry}
        onEditCategory={editBusy ? undefined : handleEditCategory}
        editingId={editingId}
        onCancelEdit={() => setEditingId(null)}
      />
    </AdminShell>
  );
}
