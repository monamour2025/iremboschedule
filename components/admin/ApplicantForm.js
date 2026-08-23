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

export default function ApplicantForm() {
  const [form, setForm] = useState({ ...emptyApplicantRow });
  const [categories, setCategories] = useState(["A", "B", "B(AT)", "C", "D", "D1", "E", "F"]);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isAddCategory = form.applicationType === APPLICATION_TYPE_ADD_CATEGORY;
  const slotCategory = isAddCategory ? form.requestedLicenseCategory : form.licenseCategory;

  async function loadScheduleCategories() {
    try {
      const response = await fetch("/api/status");
      if (response.ok) {
        const payload = await response.json();
        if (payload?.monitor?.categories?.length) {
          setCategories(payload.monitor.categories);
        }
      }
    } catch {
      // Keep default categories.
    }

    try {
      const payload = await adminFetch("/api/irembo/schedule-categories", { timeoutMs: 45000 });
      if (payload.categories?.length) {
        setCategories(payload.categories);
      }
    } catch {
      // Background refresh only.
    }
  }

  async function loadAvailableSlots(category) {
    if (!category) {
      setAvailableSlots([]);
      return;
    }
    setSlotsLoading(true);
    try {
      const response = await fetch(
        `/api/schedules?availableOnly=true&category=${encodeURIComponent(category)}&limit=300`
      );
      const payload = await response.json();
      const slots = (payload.schedules || [])
        .filter((schedule) => Number(schedule.remainingCapacity || 0) > 0)
        .sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
      setAvailableSlots(slots);
    } catch {
      setAvailableSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }

  useEffect(() => {
    loadScheduleCategories();
  }, []);

  useEffect(() => {
    loadAvailableSlots(slotCategory);
  }, [slotCategory]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!form.selectedScheduleId) {
      setError("Please select an available exam slot.");
      return;
    }

    if (isAddCategory) {
      if (!form.existingLicenseNumber) {
        setError("Fetch the existing licence before continuing.");
        return;
      }
      if (!form.requestedLicenseCategory) {
        setError("Select the new category being requested.");
        return;
      }
      if ((form.existingLicenseCategories || []).includes(form.requestedLicenseCategory)) {
        setError("Applicant already has this category.");
        return;
      }
    } else if (!isValidEntityId(form.entityId)) {
      setError("Paste the Irembo entity ID UUID in the form below.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = await adminFetch("/api/applicants", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          licenseCategory: isAddCategory ? form.requestedLicenseCategory : form.licenseCategory
        })
      });
      setForm({ ...emptyApplicantRow });
      setSlotSearch("");
      setSuccess(
        payload.queued
          ? "Applicant added. Automation is running in the background — open the automation queue to track progress."
          : "Applicant added."
      );
      await loadAvailableSlots(emptyApplicantRow.licenseCategory);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    form.selectedScheduleId &&
    availableSlots.length > 0 &&
    (isAddCategory ? form.existingLicenseNumber && form.requestedLicenseCategory : true);

  return (
    <AdminShell
      title="Add applicant"
      description="Choose first licence or add-category workflow, then save and automate."
    >
      <form onSubmit={handleSubmit} className="rounded-xl border border-teal-200 bg-teal-50 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-teal-950">Single applicant</h2>
        <p className="mt-1 text-sm text-teal-800">
          {isAddCategory
            ? "Fetch licence details, choose new category and slot, then automate. Entity ID is resolved automatically."
            : "Paste Irembo entity ID manually, then pick category, provisional licence, and exam slot."}
        </p>
        {error ? <p className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{error}</p> : null}
        {success ? (
          <div className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-900">
            {success}{" "}
            <Link href="/admin/applicants" className="font-semibold underline">
              View automation queue
            </Link>
          </div>
        ) : null}

        <div className="mt-4">
          <ApplicantEntryFields
            row={form}
            onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
            categories={categories}
            availableSlots={availableSlots}
            slotsLoading={slotsLoading}
            onFetchMessage={setError}
            onFetchSuccess={(name) => {
              setError("");
              setSuccess(
                name ? `Existing licence loaded for ${name}. Paste entity ID if needed.` : "Existing licence loaded."
              );
            }}
            rowKey="single"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Starting..." : "Add & automate"}
          </button>
          <Link
            href="/admin/applicants"
            className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-medium text-slate-700"
          >
            Open automation queue
          </Link>
        </div>
      </form>
    </AdminShell>
  );
}
