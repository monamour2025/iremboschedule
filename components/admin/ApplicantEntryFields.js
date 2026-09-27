"use client";

import { useEffect, useRef, useState } from "react";
import {
  TextField,
  SelectField,
  maskLicenseNumber,
  isValidEntityId,
  APPLICATION_TYPE_ADD_CATEGORY,
  APPLICATION_TYPE_FIRST_LICENCE
} from "./applicantUi";
import { isValidNationalIdInput, nationalIdValidationMessage, normalizeNationalIdInput } from "@/lib/nationalId";
import { fetchExistingLicenseFromApi, patchFromExistingLicensePayload } from "@/lib/existingLicenseClient";
import { adminFetch } from "@/lib/adminFetch";
import {
  dedupeExamSites,
  examCentersMatch,
  formatExamCenterLabel,
  preferCanonicalCenter,
  centerAliasKeys,
  isSystemExamCenter,
  SYSTEM_EXAM_CENTER,
  SYSTEM_EXAM_LOCATION
} from "@/lib/examCenters";
import {
  formatScheduleDateLocal,
  normalizeExamTimeInput,
  resolveScheduleTime,
  scheduleMatchesCategory
} from "@/lib/scheduleTime";

const ENTITY_ID_HELP =
  "From irembo.gov.rw: open the driving-licence form with the same National ID → DevTools → Network → record/external → profileDto.entityId";

function ExistingLicenseCard({ row }) {
  if (!row.existingLicenseNumber) {
    return null;
  }

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 sm:col-span-2 lg:col-span-3">
      <h4 className="text-sm font-semibold text-emerald-950">Existing driving licence</h4>
      <dl className="mt-3 grid gap-2 text-sm text-emerald-900 sm:grid-cols-2">
        <div>
          <dt className="font-medium">Name</dt>
          <dd>{row.fullName || "-"}</dd>
        </div>
        <div>
          <dt className="font-medium">Licence number</dt>
          <dd>{maskLicenseNumber(row.existingLicenseNumber)}</dd>
        </div>
        <div>
          <dt className="font-medium">Current category</dt>
          <dd>{row.existingLicenseCategory || "-"}</dd>
        </div>
        <div>
          <dt className="font-medium">Status</dt>
          <dd>{row.existingLicenseStatus || "-"}</dd>
        </div>
        <div>
          <dt className="font-medium">Date of issue</dt>
          <dd>{row.existingLicenseIssueDate || "-"}</dd>
        </div>
        <div>
          <dt className="font-medium">Expiry</dt>
          <dd>{row.existingLicenseExpiry || "-"}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="font-medium">Existing vehicle class</dt>
          <dd className="font-mono text-xs">{row.existingLicenseVehicleClass || "-"}</dd>
        </div>
      </dl>
    </div>
  );
}

function handleEntityIdChange(onChange, value) {
  const trimmed = value.trim();
  const valid = isValidEntityId(trimmed);
  onChange({
    entityId: trimmed,
    entityIdLookupStatus: valid ? "ready" : "idle",
    entityIdLookupError: valid ? "" : trimmed ? "Must be a UUID from profileDto.entityId" : ""
  });
}

function locationsMatch(scheduleLocation, selectedLocation) {
  const selected = String(selectedLocation || "").trim().toLowerCase();
  if (!selected) {
    return true;
  }
  const location = String(scheduleLocation || "").trim().toLowerCase();
  if (!location) {
    return false;
  }
  return location === selected || location.includes(selected) || selected.includes(location);
}

function matchesActiveCategory(schedule, category) {
  return scheduleMatchesCategory(schedule, category);
}

function collectScheduleTimes(slots, { activeCategory, row, strictSiteFilter = false }) {
  return [
    ...new Set(
      slots
        .filter((schedule) => {
          if (activeCategory && !matchesActiveCategory(schedule, activeCategory)) {
            return false;
          }
          if (strictSiteFilter) {
            return (
              examCentersMatch(schedule.center, row.examCenter) &&
              locationsMatch(schedule.location, row.preferredLocation) &&
              Boolean(resolveScheduleTime(schedule))
            );
          }
          return Boolean(resolveScheduleTime(schedule));
        })
        .map((schedule) => resolveScheduleTime(schedule))
        .filter(Boolean)
    )
  ].sort();
}

export function ApplicantEntryFields({
  row,
  onChange,
  categories,
  locations = [],
  availableSlots,
  categorySlots = [],
  siteSlots = [],
  slotsCategory = "",
  slotsLoading,
  title,
  onFetchMessage,
  onFetchSuccess,
  rowKey = "0",
  slotOptional = false
}) {
  const fetchInflight = useRef(false);
  const [categorySites, setCategorySites] = useState([]);
  const [categorySitesLoading, setCategorySitesLoading] = useState(false);
  const [centerTimes, setCenterTimes] = useState([]);
  const [centerTimesLoading, setCenterTimesLoading] = useState(false);
  const isAddCategory = row.applicationType === APPLICATION_TYPE_ADD_CATEGORY;
  const activeCategory = isAddCategory ? row.requestedLicenseCategory || "" : row.licenseCategory;
  const normalizedActiveCategory = String(activeCategory || "").trim().toUpperCase();
  const normalizedSlotsCategory = String(slotsCategory || normalizedActiveCategory).trim().toUpperCase();
  const slotsReadyForCategory =
    Boolean(normalizedActiveCategory) && normalizedSlotsCategory === normalizedActiveCategory;
  const siteSlotsForRow = slotsReadyForCategory ? siteSlots : [];
  const filteredSlots = availableSlots.filter((schedule) => {
    if (!isSystemExamCenter(schedule.center)) {
      return false;
    }
    if (activeCategory && !matchesActiveCategory(schedule, activeCategory)) {
      return false;
    }
    if (!slotOptional && row.preferredExamTime?.trim()) {
      const scheduleTime = resolveScheduleTime(schedule);
      if (scheduleTime !== row.preferredExamTime.trim()) {
        return false;
      }
    }
    return true;
  });

  useEffect(() => {
    if (row.examCenter === SYSTEM_EXAM_CENTER && row.preferredLocation === SYSTEM_EXAM_LOCATION) {
      return;
    }
    onChange({
      examCenter: SYSTEM_EXAM_CENTER,
      preferredLocation: SYSTEM_EXAM_LOCATION
    });
  }, [row.examCenter, row.preferredLocation, onChange]);

  const ownedCategories = Array.isArray(row.existingLicenseCategories) ? row.existingLicenseCategories : [];
  const categoryOptions = categories.map((category) => ({
    value: category,
    label: ownedCategories.includes(category) ? `Category ${category} (already owned)` : `Category ${category}`,
    disabled: ownedCategories.includes(category)
  }));
  const slotsForSiteList = slotOptional ? availableSlots : [];
  const siteOptionsFromSlots = slotOptional
    ? [
        ...new Set(
          slotsForSiteList
            .filter((schedule) => {
              if (!normalizedActiveCategory) {
                return false;
              }
              if (!matchesActiveCategory(schedule, normalizedActiveCategory)) {
                return false;
              }
              return Boolean(schedule.center && schedule.location);
            })
            .map((schedule) => `${schedule.location}::${schedule.center}`)
        )
      ]
        .map((value) => {
          const [location, center] = value.split("::");
          return { center, location, value };
        })
        .sort((a, b) => a.center.localeCompare(b.center) || a.location.localeCompare(b.location))
    : [];

  const mergedSites = slotOptional ? [...categorySites] : [...categorySites];
  if (slotOptional) {
    for (const site of siteOptionsFromSlots) {
      const exists = mergedSites.some(
        (entry) =>
          entry.center?.toLowerCase() === site.center.toLowerCase() &&
          entry.location?.toLowerCase() === site.location.toLowerCase()
      );
      if (!exists) {
        mergedSites.push({ center: site.center, location: site.location });
      }
    }
  }
  mergedSites.sort((a, b) => a.center.localeCompare(b.center) || a.location.localeCompare(b.location));

  const slotBackedCenters = slotOptional
    ? new Set(siteOptionsFromSlots.flatMap((site) => centerAliasKeys(site.center)))
    : new Set();
  const examSiteOptions = slotOptional
    ? dedupeExamSites(mergedSites.length > 0 ? mergedSites : siteOptionsFromSlots, slotBackedCenters)
    : dedupeExamSites(categorySites, new Set());
  const pickSlotSiteReady = !slotOptional && Boolean(normalizedActiveCategory);
  const pickSlotSlotsReady = pickSlotSiteReady && Boolean(row.examCenter?.trim());
  const pickSlotLoading = pickSlotSlotsReady && (slotsLoading || !slotsReadyForCategory);

  function resolveSiteByCenter(center) {
    return mergedSites.find((site) => examCentersMatch(site.center, center)) ||
      siteOptionsFromSlots.find((site) => examCentersMatch(site.center, center));
  }

  function siteSelectValue() {
    if (!row.examCenter?.trim()) {
      return "";
    }
    const match = resolveSiteByCenter(row.examCenter);
    return match?.center || row.examCenter;
  }

  function handleSiteChange(value) {
    if (!value) {
      onChange({
        examCenter: "",
        preferredLocation: "",
        selectedScheduleId: "",
        preferredExamTime: ""
      });
      return;
    }
    const site = resolveSiteByCenter(value);
    onChange({
      examCenter: preferCanonicalCenter(site?.center || value),
      preferredLocation: site?.location || "",
      selectedScheduleId: "",
      preferredExamTime: slotOptional ? row.preferredExamTime : ""
    });
  }

  function handleManualSiteChange(value) {
    const site = resolveSiteByCenter(value);
    onChange({
      examCenter: preferCanonicalCenter(value),
      selectedScheduleId: "",
      preferredExamTime: slotOptional ? row.preferredExamTime : "",
      preferredLocation: site?.location || ""
    });
  }

  const timesFromSlots = collectScheduleTimes(availableSlots, {
    activeCategory,
    row,
    strictSiteFilter: Boolean(row.examCenter?.trim())
  });
  const typedDesiredTime = normalizeExamTimeInput(row.preferredExamTime || row.examTime);
  const estimateTimeOptions = [...new Set([...timesFromSlots, ...centerTimes, typedDesiredTime].filter(Boolean))].sort();
  const timeOptions = estimateTimeOptions;

  function applyDesiredTime(value) {
    const preferredExamTime = normalizeExamTimeInput(value);
    onChange({ preferredExamTime, examTime: preferredExamTime });
  }

  function resetWorkflowFields(applicationType) {
    onChange({
      applicationType,
      requestedLicenseCategory: "",
      selectedScheduleId: "",
      provisionalLicenseNumber: "",
      provisionalLicenseExpiry: "",
      entityId: "",
      entityIdLookupStatus: "idle",
      entityIdLookupError: "",
      existingLicenseId: "",
      existingLicenseFirstName: "",
      existingLicenseLastName: "",
      existingLicenseNumber: "",
      existingLicenseCategory: "",
      existingLicenseCategories: [],
      existingLicenseVehicleClass: "",
      existingLicenseStatus: "",
      existingLicenseExpiry: "",
      existingLicenseIssueDate: "",
      existingLicenseDocumentType: "",
      existingLicenseApplicationNumber: "",
      existingLicenseFetchStatus: "idle",
      existingLicenseFetchError: ""
    });
  }

  const nationalIdValue = normalizeNationalIdInput(row.nationalId);
  const nationalIdHint = nationalIdValidationMessage(row.nationalId);
  const nationalIdReady = isValidNationalIdInput(nationalIdValue);
  const hasEntityId = isValidEntityId(row.entityId);

  function reportFetchMessage(message) {
    if (onFetchMessage) {
      onFetchMessage(message);
    }
  }

  async function runExistingLicenseFetch() {
    if (fetchInflight.current) {
      return;
    }

    if (!nationalIdReady) {
      const message = nationalIdHint || "Enter a valid 13- or 16-digit national ID.";
      onChange({
        existingLicenseFetchStatus: "error",
        existingLicenseFetchError: message
      });
      reportFetchMessage(message);
      return;
    }

    fetchInflight.current = true;
    onChange({
      existingLicenseFetchStatus: "loading",
      existingLicenseFetchError: ""
    });
    reportFetchMessage("");

    try {
      const payload = await fetchExistingLicenseFromApi({
        nationalId: nationalIdValue,
        fullName: row.fullName,
        requestedLicenseCategory: row.requestedLicenseCategory
      });
      const patch = patchFromExistingLicensePayload(payload);
      onChange({
        ...patch,
        fullName: patch.fullName || row.fullName,
        existingLicenseFetchStatus: "ready",
        entityId: patch.entityId || row.entityId,
        entityIdLookupStatus: isValidEntityId(patch.entityId || row.entityId) ? "ready" : row.entityIdLookupStatus,
        entityIdLookupError: isValidEntityId(patch.entityId || row.entityId) ? "" : row.entityIdLookupError
      });
      reportFetchMessage("");
      if (onFetchSuccess) {
        onFetchSuccess(patch.fullName || row.fullName);
      }
    } catch (error) {
      const message = error.message || "Could not fetch existing licence.";
      onChange({
        existingLicenseFetchStatus: "error",
        existingLicenseFetchError: message
      });
      reportFetchMessage(message);
    } finally {
      fetchInflight.current = false;
    }
  }

  const addCategoryHint =
    row.existingLicenseFetchStatus === "loading"
      ? "Fetching existing licence..."
      : row.existingLicenseNumber
        ? hasEntityId
          ? "Licence and Irembo profile linked. Select the new category."
          : "Licence loaded. Paste Irembo entity ID below if needed, then pick the new category."
        : nationalIdReady
          ? "Click Fetch licence to load existing licence details."
          : "Enter national ID, then fetch licence details.";

  const firstLicenceHint = hasEntityId
    ? "Entity ID saved. Select category and provisional licence."
    : "Paste the Irembo entity ID from DevTools (see help below).";

  return (
    <>
      {title ? <h3 className="mb-3 text-sm font-semibold text-slate-900">{title}</h3> : null}

      <fieldset className="mb-4 rounded-lg border border-red-100 bg-white p-4 sm:col-span-2 lg:col-span-3">
        <legend className="px-1 text-sm font-semibold text-red-950">Application type</legend>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name={`applicationType-${rowKey}`}
              checked={row.applicationType !== APPLICATION_TYPE_ADD_CATEGORY}
              onChange={() => resetWorkflowFields(APPLICATION_TYPE_FIRST_LICENCE)}
            />
            First licence
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="radio"
              name={`applicationType-${rowKey}`}
              checked={row.applicationType === APPLICATION_TYPE_ADD_CATEGORY}
              onChange={() => resetWorkflowFields(APPLICATION_TYPE_ADD_CATEGORY)}
            />
            Add new category
          </label>
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <TextField
          label="Full name"
          value={row.fullName}
          placeholder="As printed on national ID"
          onChange={(value) => onChange({ fullName: value })}
        />
        <div>
          <TextField
            label="National ID"
            value={row.nationalId}
            onChange={(value) =>
              onChange({
                nationalId: value,
                existingLicenseNumber: "",
                existingLicenseCategory: "",
                existingLicenseCategories: [],
                existingLicenseFetchStatus: "idle",
                existingLicenseFetchError: ""
              })
            }
          />
          {nationalIdHint && row.nationalId ? (
            <p className="mt-1 text-xs text-amber-700">{nationalIdHint}</p>
          ) : null}
        </div>

        {isAddCategory ? (
          <div className="sm:col-span-2 lg:col-span-3">
            <button
              type="button"
              disabled={row.existingLicenseFetchStatus === "loading"}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void runExistingLicenseFetch();
              }}
              className="h-10 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {row.existingLicenseFetchStatus === "loading" ? "Fetching..." : "Fetch licence"}
            </button>
            <p className="mt-2 text-xs text-slate-600">{addCategoryHint}</p>
            {row.existingLicenseFetchError ? (
              <p className="mt-1 text-xs text-amber-700">{row.existingLicenseFetchError}</p>
            ) : null}
          </div>
        ) : (
          <p className="sm:col-span-2 lg:col-span-3 text-xs text-slate-600">{firstLicenceHint}</p>
        )}

        <div className="sm:col-span-2 lg:col-span-3">
          <TextField
            label="Irembo entity ID"
            placeholder="e.g. 91b89b63-90df-42aa-9617-3878d15b0445"
            required={!isAddCategory}
            value={row.entityId}
            onChange={(value) => handleEntityIdChange(onChange, value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            {isAddCategory
              ? "Filled automatically when Fetch licence links your profile. Paste manually from DevTools if empty."
              : ENTITY_ID_HELP}
          </p>
          {row.entityIdLookupError ? (
            <p className="mt-1 text-xs text-amber-700">{row.entityIdLookupError}</p>
          ) : null}
          {hasEntityId ? (
            <p className="mt-1 text-xs text-emerald-700">Profile linked ({row.entityId.slice(0, 8)}…).</p>
          ) : null}
        </div>

        <TextField
          label="Phone"
          placeholder="0781234567"
          value={row.phone}
          onChange={(value) => onChange({ phone: value })}
        />
        <TextField
          label="Email (optional)"
          type="email"
          required={false}
          placeholder="Skip if not available"
          value={row.email}
          onChange={(value) => onChange({ email: value })}
        />

        {isAddCategory ? (
          <>
            <ExistingLicenseCard row={row} />
            <SelectField
              label="Requested category"
              value={row.requestedLicenseCategory}
              onChange={(value) =>
                onChange({
                  requestedLicenseCategory: value,
                  licenseCategory: value,
                  selectedScheduleId: "",
                  examCenter: row.examCenter || SYSTEM_EXAM_CENTER,
                  preferredLocation: row.preferredLocation || SYSTEM_EXAM_LOCATION,
                  preferredExamTime: row.preferredExamTime || ""
                })
              }
              options={[
                { value: "", label: "Select new category..." },
                ...categoryOptions.map((option) => ({
                  value: option.value,
                  label: option.label,
                  disabled: option.disabled
                }))
              ]}
            />
          </>
        ) : (
          <>
            <SelectField
              label="License category"
              value={row.licenseCategory}
              onChange={(value) =>
                onChange({
                  licenseCategory: value,
                  selectedScheduleId: "",
                  examCenter: row.examCenter || SYSTEM_EXAM_CENTER,
                  preferredLocation: row.preferredLocation || SYSTEM_EXAM_LOCATION,
                  preferredExamTime: row.preferredExamTime || ""
                })
              }
              options={categories.map((category) => ({ value: category, label: `Category ${category}` }))}
            />
            <TextField
              label="Provisional licence"
              placeholder="e.g. BUS0103102514054/P"
              value={row.provisionalLicenseNumber}
              onChange={(value) => onChange({ provisionalLicenseNumber: value })}
            />
            <TextField
              label="Licence expiry (optional)"
              placeholder="e.g. 03/10/2026"
              required={false}
              value={row.provisionalLicenseExpiry}
              onChange={(value) => onChange({ provisionalLicenseExpiry: value })}
            />
          </>
        )}

        <fieldset className="sm:col-span-2 lg:col-span-3 rounded-lg border border-red-100 bg-white p-4">
          <legend className="px-1 text-sm font-semibold text-red-950">Exam site</legend>
          <p className="text-sm text-slate-700">
            {SYSTEM_EXAM_CENTER} · {SYSTEM_EXAM_LOCATION}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            The system books this site automatically when the category opens. No slot to pick.
          </p>
        </fieldset>
      </div>
    </>
  );
}
