"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import EstimatePeopleBoard, { estimateProgress } from "@/components/admin/EstimatePeopleBoard";
import { adminFetch } from "@/lib/adminFetch";

function requestedCategory(applicant) {
  return String(applicant?.requestedLicenseCategory || applicant?.licenseCategory || "").trim().toUpperCase();
}

/** Modal shown before firing run-all, listing how many people per category will be triggered. */
function RunAllConfirmModal({ applicants, onConfirm, onCancel, busy }) {
  const grouped = useMemo(() => {
    const map = {};
    for (const a of applicants) {
      if (estimateProgress(a).key === "created") continue;
      const cat = requestedCategory(a);
      if (!cat) continue;
      map[cat] = (map[cat] || 0) + 1;
    }
    return map;
  }, [applicants]);

  const categories = Object.keys(grouped).sort();
  const total = categories.reduce((s, c) => s + grouped[c], 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold text-slate-900">Create Applications Now</h2>
        <p className="mt-2 text-sm text-slate-600">
          This will immediately trigger Irembo application creation for{" "}
          <span className="font-semibold text-slate-900">{total} waiting</span>{" "}
          {total === 1 ? "person" : "people"}. Each applicant is only booked into their own category.
        </p>
        {categories.length > 0 ? (
          <div className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
            {categories.map((cat) => (
              <div key={cat} className="flex items-center justify-between px-4 py-2.5 bg-white">
                <span className="text-sm font-medium text-slate-800">Category {cat}</span>
                <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-800 ring-1 ring-red-100">
                  {grouped[cat]} {grouped[cat] === 1 ? "person" : "people"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No waiting applicants found.</p>
        )}
        <div className="mt-5 flex gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || total === 0}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? "Starting\u2026" : `Confirm \u2014 ${total} ${total === 1 ? "person" : "people"}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ApplicantsList() {
  const [applicants, setApplicants] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);
  const [holdBusy, setHoldBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editBusy, setEditBusy] = useState(false);
  const editingIdRef = useRef(null);
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  async function loadApplicants(silent = false) {
    if (silent && pollInFlightRef.current) {
      return;
    }
    if (!silent) {
      setLoading(true);
    }
    pollInFlightRef.current = true;
    try {
      const payload = await adminFetch(silent ? "/api/applicants?live=1" : "/api/applicants", {
        timeoutMs: silent ? 15000 : 120000
      });
      const next = payload.applicants || [];
      const keepId = editingIdRef.current;
      setApplicants((current) => {
        if (!keepId) {
          return next;
        }
        const editing = current.find((row) => row.id === keepId);
        return next.map((row) => (row.id === keepId && editing ? editing : row));
      });
      if (!silent) {
        setError("");
      }
    } catch (loadError) {
      if (!silent) {
        setError(loadError.message);
      }
    } finally {
      pollInFlightRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadApplicants();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }
      loadApplicants(true);
    }, 2500);
    return () => clearInterval(timer);
  }, []);

  async function handleCreateApplications() {
    setCreateBusy(true);
    setError("");
    setSuccess("");
    setShowConfirm(false);
    try {
      const payload = await adminFetch("/api/applicants/run-all", {
        method: "POST",
        body: "{}"
      });
      if (payload.ok) {
        const parts = [];
        for (const [cat, info] of Object.entries(payload.byCategory || {})) {
          if (info.triggered > 0) {
            parts.push(`${info.triggered} Cat ${cat}`);
          }
        }
        setSuccess(
          payload.triggered === 0
            ? payload.message || "No applicants queued \u2014 all may already be running or on cooldown."
            : `\u2705 ${payload.message}${parts.length > 0 ? ` (${parts.join(", ")})` : ""} Codes appear in the list as they are created.`
        );
      } else {
        setError(payload.error || "Failed to trigger applications.");
      }
    } catch (createError) {
      setError(createError.message);
    } finally {
      setCreateBusy(false);
    }
  }

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

  const waitingCount = applicants.filter((row) => estimateProgress(row).key !== "created").length;
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
            ? `${applicant.fullName}: Category ${category} seats found. Creating the application\u2026`
            : `${applicant.fullName} is Category ${category}. No live ${category} seats yet \u2014 watching.`
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
      description="When you know Busanza seats are open, click Create Application \u2014 each person is booked directly into their own category via the Irembo API."
      onSecretSaved={() => loadApplicants()}
    >
      {showConfirm && (
        <RunAllConfirmModal
          applicants={applicants}
          busy={createBusy}
          onConfirm={handleCreateApplications}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <section className="animate-fade-up rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-700">
          Save people on the Estimate list and pick their category. When you know Busanza seats are open,
          click <strong>Create Application</strong> \u2014 the system immediately books each person into their
          own requested category via Irembo, no scanning needed.
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
            onClick={() => {
              setError("");
              setSuccess("");
              setShowConfirm(true);
            }}
            disabled={createBusy || waitingCount === 0}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            title={
              waitingCount === 0
                ? "No applicants waiting"
                : `Trigger applications for ${waitingCount} waiting people`
            }
          >
            {createBusy ? "Creating\u2026" : "Create Application"}
          </button>
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
        description={`${visible.length} shown \u00b7 Edit changes category (use B to test) \u00b7 Delete removes the person`}
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
