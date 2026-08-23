"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminShell from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/adminFetch";
import {
  TextField,
  SelectField,
  formatSlotLabel,
  formatStatusLabel,
  formatAssignedSlotLabel,
  formatApplicationTypeLabel,
  maskLicenseNumber,
  statusTone,
  APPLICATION_TYPE_ADD_CATEGORY
} from "@/components/admin/applicantUi";

export default function ApplicantsList() {
  const [applicants, setApplicants] = useState([]);
  const [categories, setCategories] = useState(["A", "A1", "B", "B1", "C", "D", "D1", "E", "F"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [editSlots, setEditSlots] = useState([]);
  const [editSlotsLoading, setEditSlotsLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  async function loadApplicants(options = {}) {
    const { silent = false } = options;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const payload = await adminFetch("/api/applicants");
      setApplicants(payload.applicants || []);
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

  async function loadAvailableSlots(category) {
    setEditSlotsLoading(true);
    try {
      const response = await fetch(
        `/api/schedules?availableOnly=true&category=${encodeURIComponent(category)}&limit=1000`
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

  useEffect(() => {
    loadApplicants();
    fetch("/api/status")
      .then((response) => response.json())
      .then((payload) => {
        if (payload?.monitor?.categories?.length) {
          setCategories(payload.monitor.categories);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const processing = applicants.some((applicant) =>
      ["PENDING", "LOOKUP_COMPLETED", "LICENSE_VALIDATED", "RESERVING_SLOT", "SLOT_RESERVED"].includes(
        applicant.status
      )
    );
    if (!processing) {
      return undefined;
    }
    const interval = setInterval(() => loadApplicants({ silent: true }), 15000);
    return () => clearInterval(interval);
  }, [applicants]);

  async function handleLinkProfile(id) {
    setError("");
    try {
      const payload = await adminFetch(`/api/applicants/${id}/resolve-profile`, { method: "POST" });
      setSuccess(
        payload.entityId
          ? "Irembo profile linked. Automation restarted."
          : "Irembo profile linked."
      );
      await loadApplicants();
    } catch (linkError) {
      setError(linkError.message);
    }
  }

  async function handleRetry(id) {
    setError("");
    try {
      const payload = await adminFetch(`/api/applicants/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "retry" })
      });
      setSuccess(
        payload.queued
          ? "Automation restarted."
          : payload.matches?.length
            ? "Applicant matched to a detected slot."
            : "Applicant reset. Waiting for the next matching slot."
      );
      await loadApplicants();
    } catch (retryError) {
      setError(retryError.message);
    }
  }

  async function handleSetEntityId(id) {
    const entityId = window.prompt(
      "Paste the Irembo entityId (UUID) from the browser:\n\n" +
        "1. Open irembo.gov.rw → Driving license test registration\n" +
        "2. Enter the national ID\n" +
        "3. DevTools → Network → record/external → profileDto.entityId\n\n" +
        "Leave blank to cancel."
    );
    if (!entityId?.trim()) {
      return;
    }
    setError("");
    try {
      const payload = await adminFetch(`/api/applicants/${id}`, {
        method: "POST",
        body: JSON.stringify({ action: "setEntityId", entityId: entityId.trim() })
      });
      setSuccess(payload.queued ? "Entity ID saved. Automation resumed." : "Entity ID saved.");
      await loadApplicants();
    } catch (entityError) {
      setError(entityError.message);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this applicant?")) {
      return;
    }
    try {
      await adminFetch(`/api/applicants/${id}`, { method: "DELETE" });
      await loadApplicants();
    } catch (deleteError) {
      setError(deleteError.message);
    }
  }

  async function openEdit(applicant) {
    setError("");
    setSuccess("");
    setEditingId(applicant.id);
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
        entityId: row.entityId || ""
      });
      await loadAvailableSlots(row.licenseCategory || "A");
    } catch (loadError) {
      setError(loadError.message);
      setEditingId(null);
      setEditForm(null);
    }
  }

  function closeEdit() {
    setEditingId(null);
    setEditForm(null);
    setEditSlots([]);
  }

  function updateEditForm(patch) {
    setEditForm((current) => {
      const next = { ...current, ...patch };
      if (patch.licenseCategory && patch.licenseCategory !== current.licenseCategory) {
        next.selectedScheduleId = "";
        next.preferredLocation = "";
      }
      return next;
    });
    if (patch.licenseCategory) {
      loadAvailableSlots(patch.licenseCategory);
    }
  }

  function handleEditSlotChange(scheduleId) {
    const schedule = editSlots.find((slot) => slot.scheduleId === scheduleId);
    updateEditForm({
      selectedScheduleId: scheduleId,
      preferredLocation: schedule?.location || ""
    });
  }

  async function handleSaveEdit(event) {
    event.preventDefault();
    if (!editForm?.selectedScheduleId) {
      setError("Please select an available exam slot.");
      return;
    }
    setEditSaving(true);
    setError("");
    setSuccess("");
    try {
      const payload = await adminFetch(`/api/applicants/${editingId}`, {
        method: "PUT",
        body: JSON.stringify({ ...editForm, restartAutomation: true })
      });
      closeEdit();
      setSuccess(payload.queued ? "Applicant updated. Automation restarted." : "Applicant updated.");
      await loadApplicants();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setEditSaving(false);
    }
  }

  const editFilteredSlots = editForm?.preferredLocation
    ? editSlots.filter(
        (schedule) =>
          String(schedule.location || "").trim().toLowerCase() ===
          String(editForm.preferredLocation).trim().toLowerCase()
      )
    : editSlots;

  return (
    <AdminShell
      title="Automation queue"
      description="Track applicants while automation runs."
      onSecretSaved={loadApplicants}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/applicants/new"
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
          >
            Add & automate
          </Link>
          <Link href="/admin/bulk" className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium">
            Bulk automate
          </Link>
        </div>
        <button
          type="button"
          onClick={loadApplicants}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium"
        >
          Refresh
        </button>
      </div>

      {error ? <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
      {success ? <p className="rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">{success}</p> : null}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">Applicants</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">National ID</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Existing</th>
                <th className="px-4 py-3">Requested</th>
                <th className="px-4 py-3">District</th>
                <th className="px-4 py-3">Existing licence</th>
                <th className="px-4 py-3">Assigned slot</th>
                <th className="px-4 py-3">Application #</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan="12" className="px-4 py-8 text-center text-slate-500">
                    Loading...
                  </td>
                </tr>
              ) : applicants.length === 0 ? (
                <tr>
                  <td colSpan="12" className="px-4 py-8 text-center text-slate-500">
                    No applicants yet.{" "}
                    <Link href="/admin/applicants/new" className="font-medium text-teal-700 underline">
                      Add one
                    </Link>{" "}
                    or{" "}
                    <Link href="/admin/bulk" className="font-medium text-teal-700 underline">
                      schedule a bulk run
                    </Link>
                    .
                  </td>
                </tr>
              ) : (
                applicants.map((applicant) => (
                  <tr key={applicant.id}>
                    <td className="px-4 py-3 font-medium">{applicant.fullName}</td>
                    <td className="px-4 py-3">{applicant.nationalId}</td>
                    <td className="px-4 py-3">{applicant.phone}</td>
                    <td className="px-4 py-3">{formatApplicationTypeLabel(applicant.applicationType)}</td>
                    <td className="px-4 py-3">
                      {applicant.applicationType === APPLICATION_TYPE_ADD_CATEGORY
                        ? applicant.existingLicenseCategory || "-"
                        : "-"}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {applicant.applicationType === APPLICATION_TYPE_ADD_CATEGORY
                        ? applicant.requestedLicenseCategory || applicant.licenseCategory
                        : applicant.licenseCategory}
                    </td>
                    <td className="px-4 py-3">{applicant.preferredLocation || "-"}</td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {applicant.existingLicenseNumber
                        ? maskLicenseNumber(applicant.existingLicenseNumber)
                        : applicant.provisionalLicenseNumber || "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatAssignedSlotLabel(applicant)}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-emerald-700">
                      {applicant.applicationNumber || "-"}
                    </td>
                    <td className="px-4 py-3">
                      <div className={`font-medium ${statusTone(applicant.status)}`}>
                        {formatStatusLabel(applicant.status, applicant.applicationNumber)}
                      </div>
                      {applicant.batchName ? (
                        <div className="mt-1 text-xs text-slate-500">Batch: {applicant.batchName}</div>
                      ) : null}
                      {applicant.statusHint ? (
                        <div className="mt-1 max-w-xs text-xs text-slate-500">{applicant.statusHint}</div>
                      ) : null}
                      {applicant.lastError &&
                      applicant.status !== "APPLICATION_CREATED" &&
                      applicant.lastError !== applicant.statusHint &&
                      !applicant.statusHint?.includes(applicant.lastError.slice(0, 40)) ? (
                        <div className="mt-1 max-w-xs text-xs text-red-600">{applicant.lastError}</div>
                      ) : null}
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
                          onClick={() => handleRetry(applicant.id)}
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        >
                          Retry
                        </button>
                        {!applicant.entityId ? (
                          <button
                            type="button"
                            onClick={() => handleSetEntityId(applicant.id)}
                            className="rounded border border-emerald-300 px-2 py-1 text-xs font-medium text-emerald-800"
                          >
                            Set entity ID
                          </button>
                        ) : null}
                        {!applicant.entityId ? (
                          <button
                            type="button"
                            onClick={() => handleLinkProfile(applicant.id)}
                            className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-800"
                          >
                            Link profile
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleDelete(applicant.id)}
                          className="rounded border border-amber-300 px-2 py-1 text-xs text-amber-800"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingId && editForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <form
            onSubmit={handleSaveEdit}
            className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-teal-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Edit applicant</h2>
                <p className="mt-1 text-sm text-slate-600">Saving restarts automation for this applicant.</p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600"
              >
                Close
              </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TextField label="Full name" value={editForm.fullName} onChange={(v) => updateEditForm({ fullName: v })} />
              <TextField label="National ID" value={editForm.nationalId} onChange={(v) => updateEditForm({ nationalId: v })} />
              <TextField label="Phone" value={editForm.phone} onChange={(v) => updateEditForm({ phone: v })} />
              <TextField label="Email (optional)" type="email" required={false} value={editForm.email} onChange={(v) => updateEditForm({ email: v })} />
              <SelectField
                label="License category"
                value={editForm.licenseCategory}
                onChange={(v) => updateEditForm({ licenseCategory: v })}
                options={categories.map((c) => ({ value: c, label: `Category ${c}` }))}
              />
              <TextField label="Provisional licence" value={editForm.provisionalLicenseNumber} onChange={(v) => updateEditForm({ provisionalLicenseNumber: v })} />
              <TextField label="Licence expiry (optional)" required={false} value={editForm.provisionalLicenseExpiry} onChange={(v) => updateEditForm({ provisionalLicenseExpiry: v })} />
              <TextField label="Irembo entity ID" value={editForm.entityId} onChange={(v) => updateEditForm({ entityId: v })} />
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-800">
                  Available exam slot
                  <select
                    required
                    value={editForm.selectedScheduleId}
                    onChange={(e) => handleEditSlotChange(e.target.value)}
                    className="mt-1 h-10 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm"
                    disabled={editSlotsLoading}
                  >
                    <option value="">{editSlotsLoading ? "Loading..." : "Select slot"}</option>
                    {editFilteredSlots.map((schedule) => (
                      <option key={schedule.scheduleId} value={schedule.scheduleId}>
                        {formatSlotLabel(schedule)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <TextField label="District (from slot)" value={editForm.preferredLocation} onChange={() => {}} readOnly />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="submit" disabled={editSaving || !editForm.selectedScheduleId} className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
                {editSaving ? "Saving..." : "Save & restart automation"}
              </button>
              <button type="button" onClick={closeEdit} className="h-10 rounded-lg border border-slate-300 px-4 text-sm text-slate-700">
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </AdminShell>
  );
}
