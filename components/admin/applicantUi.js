import { formatScheduleDateLocal, formatScheduleTimeLocal, resolveScheduleTime } from "@/lib/scheduleTime";

export function formatAssignedSlotLabel(applicant) {
  if (applicant.assignedExam?.label) {
    return applicant.assignedExam.label;
  }

  const finished = ["APPLICATION_CREATED", "COMPLETED", "PAYMENT_PENDING", "PAID"].includes(
    applicant.status
  );
  const batchPending =
    applicant.batchName &&
    !finished &&
    (applicant.batchStatus === "DRAFT" ||
      (applicant.batchScheduledAt && new Date(applicant.batchScheduledAt) > new Date()));

  if (
    applicant.status === "WAITING_FOR_SLOT" &&
    !applicant.assignedScheduleId &&
    applicant.preferredLocation
  ) {
    const district = applicant.preferredLocation;
    const site = applicant.examCenter ? ` · ${applicant.examCenter}` : "";
    const time = applicant.preferredExamTime ? ` · ${applicant.preferredExamTime}` : "";
    const category =
      applicant.requestedLicenseCategory || applicant.existingLicenseCategory
        ? applicant.requestedLicenseCategory || applicant.licenseCategory
        : applicant.licenseCategory || "?";
    if (batchPending) {
      return `Estimate · Category ${category} · ${district}${site}${time}`;
    }
    return `Matching Category ${category} · ${district}${site}${time}`;
  }

  if (batchPending) {
    return applicant.assignedScheduleId ? "Slot saved — click Automate Codes" : "Saved — click Automate Codes";
  }
  if (applicant.status === "WAITING_FOR_SLOT") {
    return "Searching for slot...";
  }
  return "-";
}

export function maskEntityId(entityId) {
  const value = String(entityId || "").trim();
  if (!value) {
    return "";
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

const ENTITY_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidEntityId(value) {
  return ENTITY_ID_REGEX.test(String(value || "").trim());
}

export function normalizeEntityId(value) {
  return String(value || "").trim();
}

export function formatEntityIdStatus(applicant) {
  if (applicant.entityId) {
    return "Verified";
  }
  if (applicant.status === "SAVED") {
    return "Pending";
  }
  return "Pending";
}

export function formatSlotTime(startDateTime) {
  return formatScheduleTimeLocal(startDateTime);
}

export function formatSlotLabel(schedule) {
  const date = schedule.startDateTime ? formatScheduleDateLocal(schedule.startDateTime) : "";
  const time = resolveScheduleTime(schedule);
  return `${schedule.location} · ${schedule.center} · ${date}${time ? ` · ${time}` : ""} (${schedule.remainingCapacity} open)`;
}

export function statusTone(status) {
  if (status === "APPLICATION_CREATED" || status === "COMPLETED") return "text-emerald-700";
  if (status === "PAYMENT_PENDING") return "text-emerald-700";
  if (status === "PAYMENT_EXPIRED" || status === "PAYMENT_CANCELLED") return "text-amber-800";
  if (status === "WAITING_FOR_SLOT" || status === "SCHEDULED" || status === "SAVED") return "text-slate-600";
  if (status === "FAILED" || status.startsWith("FAILED_") || status === "FETCHING_PROFILE") return "text-red-700";
  if (
    ["PENDING", "FETCHING_PROFILE", "LOOKUP_COMPLETED", "LICENSE_VALIDATED", "RESERVING_SLOT", "SLOT_RESERVED"].includes(
      status
    )
  ) {
    return "text-blue-700";
  }
  if (status === "RUNNING") return "text-blue-700";
  return "text-slate-700";
}

export function formatStatusLabel(status, applicationNumber) {
  if (status === "APPLICATION_CREATED") {
    return applicationNumber ? `Success · ${applicationNumber}` : "Success";
  }
  if (status === "SAVED") return "Saved";
  if (status === "PAYMENT_PENDING") return "Payment pending";
  if (status === "PAYMENT_EXPIRED") return "Payment expired";
  if (status === "PAYMENT_CANCELLED") return "Payment cancelled";
  if (status === "COMPLETED") return "Completed";
  if (status === "WAITING_FOR_SLOT") return "Waiting for slot";
  if (status === "SCHEDULED") return "Scheduled";
  if (status === "DRAFT") return "Draft";
  if (status === "RUNNING") return "Running";
  if (status.startsWith("FAILED")) return "Failed";
  if (status === "FETCHING_PROFILE") return "Not verified";
  if (status === "PENDING") return "Processing";
  return status.replaceAll("_", " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
}

export function TextField({ label, value, onChange, type = "text", required = true, placeholder = "", readOnly = false }) {
  return (
    <label className="text-sm font-medium text-slate-800">
      {label}
      <input
        type={type}
        required={required}
        readOnly={readOnly}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1 h-10 w-full rounded-lg border border-teal-200 px-3 text-sm ${
          readOnly ? "bg-slate-100 text-slate-600" : "bg-white"
        }`}
      />
    </label>
  );
}

export function maskLicenseNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (raw.length <= 4) {
    return "****";
  }
  return `${"*".repeat(Math.max(raw.length - 4, 4))}${raw.slice(-4)}`;
}

export function formatApplicationTypeLabel(applicationType) {
  return applicationType === APPLICATION_TYPE_ADD_CATEGORY ? "Add category" : "First licence";
}

export function SelectField({ label, value, onChange, options, required = true }) {
  return (
    <label className="text-sm font-medium text-slate-800">
      {label}
      <select
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-lg border border-teal-200 bg-white px-3 text-sm"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={Boolean(option.disabled)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export const APPLICATION_TYPE_FIRST_LICENCE = "FIRST_LICENCE";
export const APPLICATION_TYPE_ADD_CATEGORY = "ADD_CATEGORY";

export const emptyApplicantRow = {
  applicationType: APPLICATION_TYPE_FIRST_LICENCE,
  fullName: "",
  nationalId: "",
  phone: "",
  email: "",
  licenseCategory: "A",
  requestedLicenseCategory: "",
  provisionalLicenseNumber: "",
  provisionalLicenseExpiry: "",
  selectedScheduleId: "",
  preferredLocation: "",
  examCenter: "",
  preferredExamTime: "",
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
};
