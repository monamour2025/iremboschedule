"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import { ApplicantEntryFields } from "@/components/admin/ApplicantEntryFields";
import { adminFetch } from "@/lib/adminFetch";
import {
  emptyApplicantRow,
  isValidEntityId,
  APPLICATION_TYPE_ADD_CATEGORY
} from "@/components/admin/applicantUi";

function buildEmptyRow() {
  return { ...emptyApplicantRow };
}

function buildAutoBatchName(rows) {
  const first = rows[0];
  if (!first) {
    return `Estimate list ${new Date().toLocaleString()}`;
  }
  const category =
    first.applicationType === APPLICATION_TYPE_ADD_CATEGORY
      ? first.requestedLicenseCategory
      : first.licenseCategory;
  return ["Estimate", category ? `Category ${category}` : null].filter(Boolean).join(" · ");
}

export default function BulkAutomationManager() {
  const [rows, setRows] = useState([buildEmptyRow()]);
  const [categories, setCategories] = useState(["A", "A1", "B", "B1", "C", "D", "D1", "E", "F"]);
  const [targetBatchId, setTargetBatchId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadLatestBatchId() {
    try {
      const payload = await adminFetch("/api/bulk-automation");
      const batches = payload.batches || [];
      const open = batches.find((batch) => ["DRAFT", "RUNNING", "SCHEDULED"].includes(batch.status));
      if (open?.id) {
        setTargetBatchId(String(open.id));
      }
    } catch {
      // Keep the current batch id if the list cannot refresh.
    }
  }

  useEffect(() => {
    loadLatestBatchId();
    fetch("/api/status")
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.monitor?.categories?.length) {
          setCategories(payload.monitor.categories);
        }
      })
      .catch(() => {});
  }, []);

  function updateRow(index, patch) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [...current, buildEmptyRow()]);
  }

  function removeRow(index) {
    setRows((current) => (current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index)));
  }

  async function handleSave(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const missingSite = rows.find((row) => !row.examCenter?.trim());
    if (missingSite) {
      setError(`${missingSite.fullName || "Each person"} needs the exam site.`);
      return;
    }

    const missingEntityId = rows.find(
      (row) =>
        row.applicationType !== APPLICATION_TYPE_ADD_CATEGORY && !isValidEntityId(row.entityId)
    );
    if (missingEntityId) {
      setError(`${missingEntityId.fullName || "Each person"} needs an Irembo entity ID.`);
      return;
    }

    const missingFetchedLicense = rows.find(
      (row) =>
        row.applicationType === APPLICATION_TYPE_ADD_CATEGORY && !String(row.existingLicenseNumber || "").trim()
    );
    if (missingFetchedLicense) {
      setError(`${missingFetchedLicense.fullName || "Each person"}: click Fetch licence first.`);
      return;
    }

    const missingRequestedCategory = rows.find((row) => {
      const category =
        row.applicationType === APPLICATION_TYPE_ADD_CATEGORY
          ? row.requestedLicenseCategory
          : row.licenseCategory;
      return !String(category || "").trim();
    });
    if (missingRequestedCategory) {
      setError(`${missingRequestedCategory.fullName || "Each person"}: select the category.`);
      return;
    }

    const missingProvisional = rows.find(
      (row) =>
        row.applicationType !== APPLICATION_TYPE_ADD_CATEGORY &&
        !String(row.provisionalLicenseNumber || "").trim()
    );
    if (missingProvisional) {
      setError(`${missingProvisional.fullName || "Each person"} needs a provisional licence number.`);
      return;
    }

    setSaving(true);
    try {
      const payload = await adminFetch("/api/bulk-automation", {
        method: "POST",
        body: JSON.stringify({
          name: buildAutoBatchName(rows),
          batchId: targetBatchId || null,
          listMode: "estimate",
          autoStart: true,
          applicants: rows
        }),
        timeoutMs: 20000
      });
      const savedCount = payload.applicants?.length || rows.length;
      setSuccess(
        `Saved ${savedCount} ${savedCount === 1 ? "person" : "people"}. They are in Queue — the scanner books when that category opens.`
      );
      setRows([buildEmptyRow()]);
      const batchId = payload.batch?.id || payload.id;
      if (batchId) {
        setTargetBatchId(String(batchId));
      }
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminShell
      title="Estimate list"
      description="Add people here. Queue watches Irembo and books the category they asked for."
      onSecretSaved={() => loadLatestBatchId()}
    >
      <form onSubmit={handleSave} className="animate-fade-up rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-red-950">Add people</h2>
        <p className="mt-1 text-sm text-slate-600">
          First licence or Add new category. After save, progress lives in{" "}
          <Link href="/admin/applicants" className="font-semibold text-red-800 underline">
            Queue
          </Link>
          .
        </p>

        {error ? <p className="mt-3 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-900">{error}</p> : null}
        {success ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{success}</p>
        ) : null}

        <div className="mt-6 space-y-4">
          {rows.map((row, index) => (
            <div key={index} className="animate-fade-up rounded-xl border border-red-100 bg-red-50/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Person {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              <ApplicantEntryFields
                row={row}
                onChange={(patch) => updateRow(index, patch)}
                categories={categories}
                locations={[]}
                availableSlots={[]}
                categorySlots={[]}
                siteSlots={[]}
                slotsCategory=""
                slotsLoading={false}
                onFetchMessage={setError}
                rowKey={String(index)}
                slotOptional
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-800 transition hover:bg-red-50"
          >
            Add another person
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save to estimate list"}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
