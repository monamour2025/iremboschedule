"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import { ApplicantEntryFields } from "@/components/admin/ApplicantEntryFields";
import { adminFetch } from "@/lib/adminFetch";
import { buildSlotCacheKey, examCentersMatch, preferCanonicalCenter } from "@/lib/examCenters";
import { scheduleMatchesLocationFilter } from "@/lib/monitorPriority";
import { scheduleMatchesCategory } from "@/lib/scheduleTime";
import {
  emptyApplicantRow,
  formatAssignedSlotLabel,
  formatEntityIdStatus,
  formatStatusLabel,
  statusTone,
  TextField,
  isValidEntityId,
  APPLICATION_TYPE_ADD_CATEGORY
} from "@/components/admin/applicantUi";

function listApplicantStatus(applicant) {
  if (applicant.status === "WAITING_FOR_SLOT" && !applicant.assignedScheduleId) {
    return "Estimate";
  }
  if (applicant.status === "SAVED") {
    return "Ready";
  }
  return formatStatusLabel(applicant.status, applicant.applicationNumber);
}

function buildEmptyRow(defaults = {}) {
  return {
    ...emptyApplicantRow,
    licenseCategory: defaults.licenseCategory || emptyApplicantRow.licenseCategory,
    preferredLocation: defaults.preferredLocation || ""
  };
}

function isEstimateDraftBatch(batch) {
  const applicants = batch?.applicants || [];
  if (applicants.length === 0) {
    return false;
  }
  return applicants.every(
    (row) => row.status === "WAITING_FOR_SLOT" && !row.assignedScheduleId
  );
}

function buildAutoBatchName(rows, listMode) {
  const first = rows[0];
  if (!first) {
    return `Bulk list ${new Date().toLocaleString()}`;
  }
  const category =
    first.applicationType === APPLICATION_TYPE_ADD_CATEGORY
      ? first.requestedLicenseCategory
      : first.licenseCategory;
  const site = String(first.examCenter || "").trim();
  const parts = [
    listMode === "slot" ? "Pick slot" : "Estimate",
    category ? `Category ${category}` : null,
    site || null
  ].filter(Boolean);
  return parts.join(" · ");
}

export default function BulkAutomationManager() {
  const [listMode, setListMode] = useState("estimate");
  const [defaultLocation, setDefaultLocation] = useState("");
  const [locations, setLocations] = useState([]);
  const [targetBatchId, setTargetBatchId] = useState("");
  const [rows, setRows] = useState([buildEmptyRow()]);
  const [slotsByCategory, setSlotsByCategory] = useState({});
  const [loadingCategories, setLoadingCategories] = useState({});
  const [categories, setCategories] = useState(["A", "A1", "B", "B1", "C", "D", "D1", "E", "F"]);
  const [batches, setBatches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [automatingId, setAutomatingId] = useState(null);
  const [cancellingId, setCancellingId] = useState(null);
  const [editingApplicant, setEditingApplicant] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSlots, setEditSlots] = useState([]);
  const [editSlotsLoading, setEditSlotsLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const draftBatches = useMemo(() => batches.filter((batch) => batch.status === "DRAFT"), [batches]);
  const runningBatches = useMemo(() => batches.filter((batch) => batch.status === "RUNNING"), [batches]);
  const savedDraftBatches = useMemo(
    () => draftBatches.filter((batch) => batch.applicantCount > 0),
    [draftBatches]
  );
  const activeDraftBatch = useMemo(() => {
    if (targetBatchId) {
      const selected = draftBatches.find((batch) => String(batch.id) === targetBatchId);
      if (selected?.applicantCount > 0) {
        return selected;
      }
    }
    return savedDraftBatches[0] || null;
  }, [draftBatches, savedDraftBatches, targetBatchId]);


  async function loadBatches(silent = false) {
    try {
      const payload = await adminFetch("/api/bulk-automation");
      setBatches(payload.batches || []);
    } catch (loadError) {
      if (!silent) {
        setError(loadError.message);
      }
    }
  }

  async function loadAvailableSlots(category, location = "", center = "", options = {}) {
    const normalizedCategory = String(category || "").trim().toUpperCase();
    const normalizedCenter = center ? preferCanonicalCenter(center.trim()) : "";
    const cacheKey = buildSlotCacheKey(normalizedCategory, normalizedCenter);
    if (!normalizedCategory || loadingCategories[cacheKey]) {
      return;
    }
    if (slotsByCategory[cacheKey] && !options.force) {
      return;
    }
    setLoadingCategories((current) => ({ ...current, [cacheKey]: true }));
    try {
      const locationParam = location ? `&location=${encodeURIComponent(location)}` : "";
      const centerParam = normalizedCenter ? `&center=${encodeURIComponent(normalizedCenter)}` : "";
      const pickerParam = normalizedCenter ? "" : "&forPicker=true";
      const payload = await adminFetch(
        `/api/schedules?availableOnly=true&category=${encodeURIComponent(normalizedCategory)}${locationParam}${centerParam}${pickerParam}&limit=${normalizedCenter ? 1000 : 5000}`,
        { timeoutMs: 45000 }
      );
      const slots = (payload.schedules || [])
        .filter((schedule) => Number(schedule.remainingCapacity || 0) > 0)
        .filter(
          (schedule) =>
            scheduleMatchesCategory(schedule, normalizedCategory) &&
            (!location || scheduleMatchesLocationFilter(schedule, location)) &&
            (!normalizedCenter || examCentersMatch(schedule.center, normalizedCenter))
        )
        .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
      setSlotsByCategory((current) => ({ ...current, [cacheKey]: slots }));
    } catch {
      setSlotsByCategory((current) => ({ ...current, [cacheKey]: [] }));
    } finally {
      setLoadingCategories((current) => ({ ...current, [cacheKey]: false }));
    }
  }

  useEffect(() => {
    loadBatches(true);
    fetch("/api/status")
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.monitor?.categories?.length) {
          setCategories(payload.monitor.categories);
        }
        if (payload?.monitor?.locations?.length) {
          setLocations(payload.monitor.locations);
          setDefaultLocation((current) => current || payload.monitor.locations[0] || "");
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (targetBatchId && savedDraftBatches.some((batch) => String(batch.id) === targetBatchId)) {
      return;
    }
    if (savedDraftBatches.length > 0) {
      setTargetBatchId(String(savedDraftBatches[0].id));
    }
  }, [savedDraftBatches, targetBatchId]);

  const usedSlotQueries = useMemo(() => {
    const queries = new Map();
    const addQuery = (category, location = "", center = "", force = false) => {
      if (!category) {
        return;
      }
      const cacheKey = buildSlotCacheKey(category, center);
      queries.set(cacheKey, { category, location, center, force });
    };

    if (listMode === "estimate") {
      for (const row of rows) {
        const category =
          row.applicationType === "ADD_CATEGORY" ? row.requestedLicenseCategory : row.licenseCategory;
        addQuery(category, row.preferredLocation || "", "");
        if (row.examCenter?.trim()) {
          addQuery(category, row.preferredLocation || "", row.examCenter.trim(), true);
        }
      }
      return [...queries.values()];
    }

    for (const row of rows) {
      const category =
        row.applicationType === "ADD_CATEGORY" ? row.requestedLicenseCategory : row.licenseCategory;
      if (!category || !row.examCenter?.trim()) {
        continue;
      }
      addQuery(category, row.preferredLocation || "", row.examCenter.trim(), true);
    }
    return [...queries.values()];
  }, [rows, listMode]);

  useEffect(() => {
    for (const { category, location, center, force } of usedSlotQueries) {
      const cacheKey = buildSlotCacheKey(category, center);
      if (!loadingCategories[cacheKey] && (force || !slotsByCategory[cacheKey])) {
        loadAvailableSlots(category, location, center, { force: Boolean(force) });
      }
    }
  }, [usedSlotQueries]);

  function updateRow(index, patch) {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      buildEmptyRow({
        preferredLocation: listMode === "estimate" ? defaultLocation : ""
      })
    ]);
  }

  function removeRow(index) {
    setRows((current) => (current.length === 1 ? current : current.filter((_, rowIndex) => rowIndex !== index)));
  }

  async function handleSave(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    const isEstimateMode = listMode === "estimate";

    if (isEstimateMode) {
      const missingSite = rows.find((row) => !row.selectedScheduleId && !row.examCenter?.trim());
      if (missingSite) {
        setError(`${missingSite.fullName || "Each applicant"} needs a preferred exam site.`);
        return;
      }
      const missingTime = rows.find((row) => !row.selectedScheduleId && !row.preferredExamTime?.trim());
      if (missingTime) {
        setError(`${missingTime.fullName || "Each applicant"} needs a desired time for auto-matching.`);
        return;
      }
    } else {
      const missingSite = rows.find((row) => !row.examCenter?.trim());
      if (missingSite) {
        setError(`${missingSite.fullName || "Each applicant"} needs an exam site selected.`);
        return;
      }
      const missingSlot = rows.find((row) => !row.selectedScheduleId);
      if (missingSlot) {
        setError(`${missingSlot.fullName || "Each applicant"} needs an exam date and time selected.`);
        return;
      }
      const mismatchedSlot = rows.find((row) => {
        const rowCategory =
          row.applicationType === APPLICATION_TYPE_ADD_CATEGORY
            ? row.requestedLicenseCategory
            : row.licenseCategory;
        if (!row.selectedScheduleId || !rowCategory) {
          return false;
        }
        const slotCategory = String(row.selectedScheduleId).split(":")[0]?.trim().toUpperCase();
        return slotCategory !== String(rowCategory).trim().toUpperCase();
      });
      if (mismatchedSlot) {
        const rowCategory =
          mismatchedSlot.applicationType === APPLICATION_TYPE_ADD_CATEGORY
            ? mismatchedSlot.requestedLicenseCategory
            : mismatchedSlot.licenseCategory;
        setError(
          `${mismatchedSlot.fullName || "Applicant"}: selected exam slot is not for category ${rowCategory}. Change category and pick the slot again.`
        );
        return;
      }
    }

    const missingEntityId = rows.find(
      (row) =>
        row.applicationType !== APPLICATION_TYPE_ADD_CATEGORY && !isValidEntityId(row.entityId)
    );
    if (missingEntityId) {
      setError(
        `${missingEntityId.fullName || "Each applicant"} needs an Irembo entity ID pasted in the form.`
      );
      return;
    }

    const missingFetchedLicense = rows.find(
      (row) =>
        row.applicationType === APPLICATION_TYPE_ADD_CATEGORY && !String(row.existingLicenseNumber || "").trim()
    );
    if (missingFetchedLicense) {
      setError(
        `${missingFetchedLicense.fullName || "Each applicant"}: click Fetch licence before saving (Add new category).`
      );
      return;
    }

    const missingRequestedCategory = rows.find(
      (row) =>
        row.applicationType === APPLICATION_TYPE_ADD_CATEGORY &&
        !String(row.requestedLicenseCategory || "").trim()
    );
    if (missingRequestedCategory) {
      setError(`${missingRequestedCategory.fullName || "Each applicant"}: select the requested category.`);
      return;
    }

    const missingProvisional = rows.find(
      (row) =>
        row.applicationType !== APPLICATION_TYPE_ADD_CATEGORY &&
        !String(row.provisionalLicenseNumber || "").trim()
    );
    if (missingProvisional) {
      setError(`${missingProvisional.fullName || "Each applicant"} needs a provisional licence number.`);
      return;
    }

    setSaving(true);
    try {
      const payload = await adminFetch("/api/bulk-automation", {
        method: "POST",
        body: JSON.stringify({
          name: buildAutoBatchName(rows, listMode) || activeDraftBatch?.name || "",
          batchId: targetBatchId || activeDraftBatch?.id || null,
          listMode,
          applicants: rows
        })
      });
      const savedCount = payload.applicants?.length || rows.length;
      setSuccess(
        isEstimateMode
          ? payload.autoStarted
            ? `Saved and started monitoring ${savedCount} estimate applicant(s). The system will match slots and create codes automatically when detected.`
            : `Saved ${savedCount} estimate applicant(s). Monitoring will start automatically.`
          : `Saved ${savedCount} applicant(s) to the list. Click Automate Codes when ready.`
      );
      setRows([buildEmptyRow({ preferredLocation: defaultLocation })]);
      const batchId = payload.batch?.id || payload.id;
      if (!targetBatchId && batchId) {
        setTargetBatchId(String(batchId));
      }
      await loadBatches();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (runningBatches.length === 0) {
      return undefined;
    }
    const timer = setInterval(() => {
      loadBatches(true);
    }, 5000);
    return () => clearInterval(timer);
  }, [runningBatches.length]);

  async function handleCancel(batchId) {
    if (
      !window.confirm(
        "Stop automation for this list? Applicants not finished yet will return to saved or waiting status."
      )
    ) {
      return;
    }
    setError("");
    setSuccess("");
    setCancellingId(batchId);
    try {
      await adminFetch(`/api/bulk-automation/${batchId}/cancel`, { method: "POST" });
      setSuccess("Automation cancelled. The list is back in draft — you can edit and run again later.");
      await loadBatches();
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setCancellingId(null);
    }
  }

  async function handleAutomate(batchId) {
    setError("");
    setSuccess("");
    setAutomatingId(batchId);
    try {
      const payload = await adminFetch(`/api/bulk-automation/${batchId}/automate`, { method: "POST" });
      setSuccess(
        `Automating ${payload.batch?.applicantCount || 0} applicant(s) now. ${
          listMode === "estimate"
            ? "The monitor will assign matching slots as they appear."
            : "Codes will be reserved as fast as slots allow."
        }`
      );
      await loadBatches();
    } catch (automateError) {
      setError(automateError.message);
    } finally {
      setAutomatingId(null);
    }
  }

  async function loadEditSlots(category, location = "", center = "") {
    setEditSlotsLoading(true);
    try {
      const locationParam = location ? `&location=${encodeURIComponent(location)}` : "";
      const centerParam = center ? `&center=${encodeURIComponent(center)}` : "";
      const response = await fetch(
        `/api/schedules?availableOnly=true&category=${encodeURIComponent(category)}${locationParam}${centerParam}&limit=300`
      );
      const payload = await response.json();
      const slots = (payload.schedules || [])
        .filter((schedule) => Number(schedule.remainingCapacity || 0) > 0)
        .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
      setEditSlots(slots);
    } catch {
      setEditSlots([]);
    } finally {
      setEditSlotsLoading(false);
    }
  }

  async function openEdit(applicant) {
    setError("");
    setSuccess("");
    setEditingApplicant(applicant);
    try {
      const payload = await adminFetch(`/api/applicants/${applicant.id}`);
      const row = payload.applicant || applicant;
      setEditForm({
        fullName: row.fullName || "",
        nationalId: row.nationalIdFull || row.nationalId || "",
        phone: row.phone || "",
        email: row.email || "",
        licenseCategory: row.licenseCategory || "A",
        provisionalLicenseNumber: row.provisionalLicenseNumber || "",
        provisionalLicenseExpiry: row.provisionalLicenseExpiry || "",
        selectedScheduleId: row.assignedScheduleId || "",
        preferredLocation: row.preferredLocation || "",
        examCenter: row.examCenter || "",
        preferredExamTime: row.preferredExamTime || "",
        entityId: row.entityId || ""
      });
      await loadEditSlots(row.licenseCategory || "A", row.preferredLocation || "", row.examCenter || "");
    } catch (loadError) {
      setError(loadError.message);
      setEditingApplicant(null);
      setEditForm(null);
    }
  }

  function closeEdit() {
    setEditingApplicant(null);
    setEditForm(null);
    setEditSlots([]);
  }

  function updateEditForm(patch) {
    setEditForm((current) => {
      const next = { ...current, ...patch };
      if (patch.licenseCategory && patch.licenseCategory !== current.licenseCategory) {
        next.selectedScheduleId = "";
        next.preferredLocation = "";
        next.examCenter = "";
      }
      if (patch.preferredLocation && patch.preferredLocation !== current.preferredLocation) {
        next.examCenter = "";
      }
      return next;
    });
    if (patch.licenseCategory) {
      loadEditSlots(patch.licenseCategory, editForm?.preferredLocation || "", editForm?.examCenter || "");
    }
    if (patch.preferredLocation || patch.examCenter) {
      loadEditSlots(
        patch.licenseCategory || editForm?.licenseCategory || "A",
        patch.preferredLocation || editForm?.preferredLocation || "",
        patch.examCenter || editForm?.examCenter || ""
      );
    }
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    if (!editForm || !editingApplicant) {
      setError("Nothing to save.");
      return;
    }
    if (!editForm.selectedScheduleId && !editForm.examCenter?.trim()) {
      setError("Select a preferred exam site.");
      return;
    }
    if (!editForm.preferredExamTime?.trim()) {
      setError("Select a desired time.");
      return;
    }
    if (!isValidEntityId(editForm.entityId)) {
      setError("Paste the Irembo entity ID UUID in the form.");
      return;
    }
    setEditSaving(true);
    setError("");
    setSuccess("");
    try {
      await adminFetch(`/api/applicants/${editingApplicant.id}`, {
        method: "PUT",
        body: JSON.stringify(editForm)
      });
      closeEdit();
      setSuccess("Applicant updated on the bulk list.");
      await loadBatches();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleRemove(applicant) {
    if (!window.confirm(`Remove ${applicant.fullName} from this list?`)) {
      return;
    }
    setError("");
    try {
      await adminFetch(`/api/applicants/${applicant.id}`, { method: "DELETE" });
      setSuccess(`${applicant.fullName} removed from the list.`);
      await loadBatches();
    } catch (removeError) {
      setError(removeError.message);
    }
  }

  return (
    <AdminShell
      title="Bulk automate"
      description="Estimate lists auto-start when saved; pick-slot lists need Automate Codes after you choose slots."
      onSecretSaved={loadBatches}
    >
      <form onSubmit={handleSave} className="rounded-xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-teal-950">Add applicants to list</h2>
        <p className="mt-1 text-sm text-teal-800">
          {listMode === "estimate"
            ? "Estimate list: add people by category, site, and desired time. Save — the system watches for matching slots and creates codes automatically."
            : "Pick slot now: choose site, date, and time from open slots, save, then click Automate Codes."}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setListMode("estimate")}
            className={
              listMode === "estimate"
                ? "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-teal-300 bg-white px-4 py-2 text-sm font-medium text-teal-900"
            }
          >
            Estimate list
          </button>
          <button
            type="button"
            onClick={() => setListMode("slot")}
            className={
              listMode === "slot"
                ? "rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
                : "rounded-lg border border-teal-300 bg-white px-4 py-2 text-sm font-medium text-teal-900"
            }
          >
            Pick slot now
          </button>
        </div>

        {error ? <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
        {success ? (
          <div className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">
            {success}{" "}
            <Link href="/admin/applicants" className="font-semibold underline">
              Open automation queue
            </Link>
          </div>
        ) : null}

        <div className="mt-6 space-y-4">
          {rows.map((row, index) => {
            const rowCategory =
              row.applicationType === "ADD_CATEGORY" ? row.requestedLicenseCategory : row.licenseCategory;
            const categorySlotKey = buildSlotCacheKey(rowCategory);
            const siteSlotKey = buildSlotCacheKey(rowCategory, row.examCenter || "");
            const categorySlots = slotsByCategory[categorySlotKey] || [];
            const siteSlots =
              listMode === "slot" && row.examCenter?.trim() ? slotsByCategory[siteSlotKey] || [] : [];
            const rowAvailableSlots =
              listMode === "estimate" && row.examCenter?.trim()
                ? siteSlots.length > 0
                  ? siteSlots
                  : categorySlots
                : categorySlots;
            const rowSlotsLoading =
              listMode === "slot"
                ? Boolean(row.examCenter?.trim() && loadingCategories[siteSlotKey])
                : Boolean(loadingCategories[siteSlotKey]) || Boolean(loadingCategories[categorySlotKey]);

            return (
            <div key={index} className="rounded-lg border border-teal-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">Applicant {index + 1}</span>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="text-xs text-slate-500 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
              <ApplicantEntryFields
                key={`${index}-${rowCategory}-${row.examCenter || ""}`}
                row={row}
                onChange={(patch) => updateRow(index, patch)}
                categories={categories}
                locations={locations}
                availableSlots={rowAvailableSlots}
                categorySlots={listMode === "estimate" ? categorySlots : []}
                siteSlots={listMode === "slot" ? siteSlots : []}
                slotsCategory={rowCategory}
                slotsLoading={rowSlotsLoading}
                onFetchMessage={setError}
                rowKey={String(index)}
                slotOptional={listMode === "estimate"}
              />
            </div>
          );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={addRow}
            className="rounded-lg border border-teal-300 px-4 py-2 text-sm font-medium text-teal-800"
          >
            Add another applicant
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save to list"}
          </button>
        </div>
      </form>

      {runningBatches.map((batch) => (
        <section key={`running-${batch.id}`} className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-amber-950">Running · {batch.name}</h2>
              <p className="mt-1 text-sm text-amber-900">
                {batch.pendingCount} in progress · {batch.successCount} succeeded · {batch.applicantCount} total
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleCancel(batch.id)}
              disabled={cancellingId === batch.id}
              className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
            >
              {cancellingId === batch.id ? "Cancelling..." : "Cancel run"}
            </button>
          </div>
        </section>
      ))}

      {activeDraftBatch ? (
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-950">{activeDraftBatch.name}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {activeDraftBatch.applicantCount} applicant(s) saved · {formatStatusLabel(activeDraftBatch.status)}
                {(activeDraftBatch.applicants || []).some(
                  (row) => row.status === "WAITING_FOR_SLOT" && !row.assignedScheduleId
                )
                  ? " · estimate list"
                  : ""}
              </p>
            </div>
            {!isEstimateDraftBatch(activeDraftBatch) ? (
              <button
                type="button"
                onClick={() => handleAutomate(activeDraftBatch.id)}
                disabled={automatingId === activeDraftBatch.id || activeDraftBatch.applicantCount === 0}
                className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {automatingId === activeDraftBatch.id ? "Starting..." : "Automate Codes"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleAutomate(activeDraftBatch.id)}
                disabled={automatingId === activeDraftBatch.id || activeDraftBatch.applicantCount === 0}
                className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {automatingId === activeDraftBatch.id ? "Starting..." : "Start monitoring"}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">District</th>
                  <th className="px-4 py-3">Exam site</th>
                  <th className="px-4 py-3">Desired time</th>
                  <th className="px-4 py-3">Requested slot</th>
                  <th className="px-4 py-3">Profile</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(activeDraftBatch.applicants || []).map((applicant) => (
                  <tr key={applicant.id}>
                    <td className="px-4 py-3 font-medium">{applicant.fullName}</td>
                    <td className="px-4 py-3">{applicant.phone}</td>
                    <td className="px-4 py-3">{applicant.licenseCategory}</td>
                    <td className="px-4 py-3">{applicant.preferredLocation || "-"}</td>
                      <td className="px-4 py-3">{applicant.examCenter || "-"}</td>
                      <td className="px-4 py-3">{applicant.preferredExamTime || "-"}</td>
                      <td className="px-4 py-3 text-slate-600">{formatAssignedSlotLabel(applicant)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {formatEntityIdStatus(applicant)}
                    </td>
                    <td className={`px-4 py-3 font-medium ${statusTone(applicant.status)}`}>
                      {listApplicantStatus(applicant)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(applicant)}
                          className="rounded border border-teal-300 px-2 py-1 text-xs text-teal-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(applicant)}
                          className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-800"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {editingApplicant && editForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-teal-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Edit saved applicant</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {editingApplicant?.status === "WAITING_FOR_SLOT" && !editingApplicant?.assignedScheduleId
                    ? "Changes update estimate preferences. Save the list again to refresh monitoring."
                    : "Changes stay on the bulk list until you click Automate Codes."}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
              >
                Close
              </button>
            </div>
            <div className="mt-4">
              <ApplicantEntryFields
                row={editForm}
                onChange={updateEditForm}
                categories={categories}
                locations={locations}
                availableSlots={editSlots}
                slotsLoading={editSlotsLoading}
                onFetchMessage={setError}
                rowKey="edit"
                slotOptional
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={
                  editSaving ||
                  (!editForm.selectedScheduleId &&
                    (!editForm.preferredLocation?.trim() ||
                    !editForm.examCenter?.trim() ||
                    !editForm.preferredExamTime?.trim()))
                }
                className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {editSaving ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                onClick={closeEdit}
                className="h-10 rounded-lg border border-slate-300 px-4 text-sm text-slate-700"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AdminShell>
  );
}
