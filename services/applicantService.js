import { prisma, assertAutomationModels } from "../lib/db.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { DEFAULT_IREMBO_ENTITY_ID } from "../lib/automationConfig.js";
import {
  APPLICATION_TYPE_ADD_CATEGORY,
  APPLICATION_TYPE_FIRST_LICENCE,
  isAddCategoryWorkflow,
  normalizeApplicationType
} from "../lib/applicationTypes.js";
import { encryptNationalId, hashNationalId, decryptNationalId, maskNationalId } from "../lib/encryption.js";
import { extractIremboApplicationNumber, isExistingApplicationMessage } from "../lib/iremboApplicationNumbers.js";
import { resolveEntityIdForInput, repairStuckProfileApplicants, cacheEntityId, requireEntityIdInput, isValidEntityId, tryResolveEntityIdForExistingLicense } from "./entityIdService.js";
import { normalizeRwandaPhone, resolveIremboNotificationContact } from "../lib/iremboContact.js";
import { extractRawScheduleId, isBookableScheduleId } from "../lib/scheduleIds.js";
import { examCentersMatch } from "../lib/examCenters.js";
import { formatScheduleTimeLocal, normalizeExamTimeInput, resolveScheduleTime } from "../lib/scheduleTime.js";
import {
  applicantOwnsCategory,
  parseVehicleClasses
} from "../lib/vehicleClassParser.js";

export const APPLICANT_STATUSES = [
  "SAVED",
  "WAITING_FOR_SLOT",
  "PENDING",
  "FETCHING_PROFILE",
  "EXISTING_LICENSE_FETCHED",
  "READY_FOR_CATEGORY",
  "CATEGORY_SELECTED",
  "LOOKUP_COMPLETED",
  "LICENSE_VALIDATED",
  "SLOT_RESERVED",
  "APPLICATION_CREATED",
  "FAILED",
  "FAILED_LOOKUP",
  "FAILED_VALIDATION",
  "FAILED_BOOKING",
  "FAILED_APPLICATION",
  "PAYMENT_PENDING",
  "COMPLETED"
];

export function normalizeLocation(value) {
  return String(value || "").trim().toLowerCase();
}

export function scheduleMatchesApplicant(applicant, schedule) {
  const wantedCategory = String(
    applicant.requestedLicenseCategory || applicant.licenseCategory || ""
  )
    .trim()
    .toUpperCase();
  const scheduleCategory = String(schedule.category || "").trim().toUpperCase();
  if (!wantedCategory || wantedCategory !== scheduleCategory) {
    return false;
  }

  const preferredLocation = String(applicant.preferredLocation || "").trim();
  if (preferredLocation && normalizeLocation(preferredLocation) !== normalizeLocation(schedule.location)) {
    return false;
  }

  const preferredCenter = String(applicant.examCenter || "").trim();
  if (preferredCenter && !examCentersMatch(schedule.center, preferredCenter)) {
    return false;
  }

  const preferredTime = normalizeExamTimeInput(applicant.preferredExamTime);
  if (preferredTime) {
    const scheduleTime = resolveScheduleTime(schedule);
    if (scheduleTime !== preferredTime) {
      return false;
    }
  }

  return true;
}

function hasAssignedExam(applicant) {
  return Boolean(applicant.examCenter && applicant.examDate && applicant.examTime);
}

function formatExamTimeFromDate(value) {
  return formatScheduleTimeLocal(value);
}

function resolvePreferredExamTimeInput(input, fallback = "") {
  return normalizeExamTimeInput(input.preferredExamTime || fallback);
}

function resolveMatchedExamScheduleId(selectedScheduleId) {
  const bookableId = extractRawScheduleId(selectedScheduleId);
  return isBookableScheduleId(bookableId) ? bookableId : null;
}

async function resolveRequestedSchedule(selectedScheduleId, licenseCategory, expectedCenter = "") {
  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: String(selectedScheduleId) }
  });

  if (!schedule) {
    const error = new Error("Selected exam slot was not found.");
    error.statusCode = 400;
    throw error;
  }

  if (Number(schedule.remainingCapacity || 0) <= 0) {
    const error = new Error("Selected exam slot is no longer available.");
    error.statusCode = 400;
    throw error;
  }

  if (
    String(schedule.category || "").toUpperCase() !== String(licenseCategory || "").trim().toUpperCase()
  ) {
    const error = new Error("Selected slot does not match the chosen licence category.");
    error.statusCode = 400;
    throw error;
  }

  const normalizedExpectedCenter = String(expectedCenter || "").trim();
  if (normalizedExpectedCenter && !examCentersMatch(schedule.center, normalizedExpectedCenter)) {
    const error = new Error("Selected slot does not match the chosen exam site.");
    error.statusCode = 400;
    throw error;
  }

  const preferredLocation = schedule.location || "";
  if (!preferredLocation) {
    const error = new Error("Could not determine district from the selected slot.");
    error.statusCode = 400;
    throw error;
  }

  const examDate = schedule.startDateTime ? new Date(schedule.startDateTime) : null;
  return {
    schedule,
    preferredLocation,
    examCenter: schedule.center || "",
    examDate,
    examTime: formatExamTimeFromDate(examDate)
  };
}

function isExpiredOrClosedApplicationStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return ["PAYMENT_EXPIRED", "PAYMENT_CANCELLED", "EXPIRED", "FAILED", "CANCELLED"].includes(
    normalized
  );
}

/** Expired Irembo codes must not block creating a new application. */
function hasActiveUnpaidApplication(applicant) {
  const status = String(applicant?.status || "").trim().toUpperCase();
  if (
    ["PAYMENT_EXPIRED", "PAYMENT_CANCELLED", "FAILED"].includes(status) ||
    status.startsWith("FAILED_")
  ) {
    return false;
  }
  if (!["APPLICATION_CREATED", "COMPLETED", "PAYMENT_PENDING"].includes(status)) {
    return false;
  }
  const latest = applicant?.applications?.[0];
  if (!latest?.applicationNumber) {
    return status === "COMPLETED";
  }
  return !isExpiredOrClosedApplicationStatus(latest.status);
}

function statusHint(status, lastError, applicationNumber, applicant = {}) {
  switch (status) {
    case "SAVED":
      if (applicant.entityId) {
        return "Irembo profile linked. Click Automate Codes or Retry to book the slot.";
      }
      if (lastError?.includes("No live schedule found")) {
        return "That slot/time is no longer bookable on Irembo. Edit the row on the bulk form, pick another time, save, then Retry.";
      }
      if (lastError?.includes("423") || lastError?.includes("busy") || lastError?.includes("blocking profile")) {
        return "National ID saved, but Irembo profile link is still pending (busy). Wait for auto-retry on bulk form, then Retry.";
      }
      if (applicant.batch?.status && applicant.batch.status !== "DRAFT") {
        return "National ID saved — Irembo profile not linked yet. Open bulk form to finish linking, then Retry.";
      }
      return "Enter national ID to link Irembo profile, then click Automate Codes.";
    case "WAITING_FOR_SLOT":
      if (applicant.batch?.status === "SCHEDULED" && applicant.batch?.scheduledAt) {
        return `Bulk automation scheduled for ${new Date(applicant.batch.scheduledAt).toLocaleString()}.`;
      }
      return lastError?.includes("schedule error") ||
        lastError?.includes("rejected this slot") ||
        lastError?.includes("candidate schedules") ||
        lastError?.includes("rejected by Irembo")
        ? "Monitor shows open slots, but Irembo rejected booking. Pick another slot and click Retry."
        : lastError?.includes("next open slot")
          ? "Previous slot rejected. Searching for another open slot now..."
          : lastError
            ? "Finding another open slot automatically..."
            : "Actively searching detected open slots (checks every 10 seconds).";
    case "PENDING":
      if (lastError?.includes("busy") || lastError?.includes("Auto-retry")) {
        return lastError;
      }
      if (applicant.batch?.status === "DRAFT") {
        return "Saved to bulk list. Click Automate Codes when ready.";
      }
      if (applicant.entityId && (applicant.provisionalLicenseNumber || applicant.existingLicenseNumber)) {
        return isAddCategoryWorkflow(applicant.applicationType)
          ? "Citizen and existing licence verified. Reserving exam slot on Irembo..."
          : "Citizen verified. Reserving exam slot on Irembo (usually a few seconds)...";
      }
      return lastError?.includes("Provisional licence validated")
        ? lastError
        : "Booking slot and creating application on Irembo now...";
    case "FETCHING_PROFILE":
      return isAddCategoryWorkflow(applicant.applicationType)
        ? "Fetching citizen profile and existing licence from Irembo..."
        : "Profile was not verified before automation. Remove the applicant and add again.";
    case "EXISTING_LICENSE_FETCHED":
      return "Existing licence loaded. Select the requested category and continue.";
    case "READY_FOR_CATEGORY":
    case "CATEGORY_SELECTED":
      return "Existing licence confirmed. Continue with schedule selection.";
    case "LOOKUP_COMPLETED":
      return applicant.existingLicenseNumber || isAddCategoryWorkflow(applicant.applicationType)
        ? "Citizen profile found. Using existing definitive licence..."
        : "Citizen profile found. Validating provisional licence...";
    case "LICENSE_VALIDATED":
      return applicant.existingLicenseNumber || isAddCategoryWorkflow(applicant.applicationType)
        ? "Existing licence confirmed. Preparing slot reservation..."
        : "Provisional licence confirmed. Preparing slot reservation...";
    case "RESERVING_SLOT":
      return "Reserving exam slot on Irembo (usually 10–30 seconds)...";
    case "SLOT_RESERVED":
      return "Slot held. Submitting application for your code (usually under 20 seconds)...";
    case "APPLICATION_CREATED":
      if (lastError?.includes("already exists") || lastError?.includes("ntarishyurwa")) {
        return lastError;
      }
      if (lastError?.includes("submitted. Irembo SMS")) {
        return lastError;
      }
      return applicationNumber
        ? `Application ${applicationNumber} created. Irembo sends SMS/email to the phone and email on this form.`
        : "Application created successfully.";
    case "PAYMENT_EXPIRED":
      return applicationNumber
        ? `Application ${applicationNumber} payment expired on Irembo. Create a new application.`
        : "Previous application payment expired on Irembo. Create a new application.";
    case "PAYMENT_CANCELLED":
      return applicationNumber
        ? `Application ${applicationNumber} was cancelled on Irembo.`
        : "Application was cancelled on Irembo.";
    case "FAILED":
      if (lastError?.includes("cooling down") || lastError?.includes("busy for")) {
        return lastError;
      }
      if (
        lastError?.includes("schedule") ||
        lastError?.includes("rejected by Irembo") ||
        lastError?.includes("candidate schedules")
      ) {
        return "Slot booking failed on Irembo. Pick another slot and click Retry.";
      }
      return lastError?.includes("blocking profile")
        ? "Irembo is rate-limiting profile lookups. Wait, then click Retry."
        : lastError || "Automation failed. Click Retry.";
    case "FAILED_LOOKUP":
      if (lastError?.includes("busy") || lastError?.includes("423") || lastError?.includes("cooling down")) {
        return "Irembo profile link is queued — auto-retry running. Wait ~10 min, do not spam Retry.";
      }
      return lastError?.includes("423") || lastError?.includes("blocking profile")
        ? "Irembo blocked profile lookup. Auto-retry is running — wait before Retry."
        : lastError || "Profile not verified yet. Auto-retry or open bulk form to link.";
    case "FAILED_VALIDATION":
      if (applicant.existingLicenseNumber || isAddCategoryWorkflow(applicant.applicationType)) {
        return lastError || "Existing licence step failed on Irembo. Click Retry.";
      }
      return lastError?.includes("prisma") || lastError?.includes("Unknown argument")
        ? "Database save failed after validation. Click Retry."
        : lastError || "Provisional licence validation failed. Check the national ID.";
    case "FAILED_BOOKING":
      return lastError?.includes("schedule error") || lastError?.includes("next open slot")
        ? "That slot was rejected. Click Retry to try the next available one."
        : "Slot booking failed. Click Retry.";
    case "FAILED_APPLICATION":
      return "Application submission failed. Click Retry.";
    default:
      return "";
  }
}

function formatAssignedExam(applicant) {
  if (!hasAssignedExam(applicant)) {
    return null;
  }

  const date = applicant.examDate ? applicant.examDate.toISOString().slice(0, 10) : "";
  const time = applicant.examTime || "";
  return {
    center: applicant.examCenter || "",
    date,
    time,
    label: [applicant.examCenter, date, time].filter(Boolean).join(" · ")
  };
}

async function enrichApplicantExtendedFields(applicant) {
  if (!applicant) {
    return applicant;
  }

  try {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        "provisionalLicenseNumber",
        "provisionalLicenseExpiry",
        "applicationType",
        "existingLicenseId",
        "existingLicenseNumber",
        "existingLicenseCategory",
        "existingLicenseCategories",
        "existingLicenseExpiry",
        "existingLicenseIssueDate",
        "existingLicenseStatus",
        "existingLicenseDocumentType",
        "existingLicenseApplicationNumber",
        "existingLicenseVehicleClass",
        "existingLicenseFetchedAt",
        "requestedLicenseCategory",
        "preferredExamTime"
      FROM "Applicant"
      WHERE "id" = ${Number(applicant.id)}
      LIMIT 1
    `);
    const row = rows[0] || {};
    let existingLicenseCategoriesParsed = [];
    if (row.existingLicenseCategories) {
      try {
        existingLicenseCategoriesParsed = JSON.parse(row.existingLicenseCategories);
      } catch {
        existingLicenseCategoriesParsed = parseVehicleClasses(row.existingLicenseVehicleClass);
      }
    }

    return {
      ...applicant,
      provisionalLicenseNumber: row.provisionalLicenseNumber ?? null,
      provisionalLicenseExpiry: row.provisionalLicenseExpiry ?? null,
      applicationType: row.applicationType || APPLICATION_TYPE_FIRST_LICENCE,
      existingLicenseId: row.existingLicenseId ?? null,
      existingLicenseNumber: row.existingLicenseNumber ?? null,
      existingLicenseCategory: row.existingLicenseCategory ?? null,
      existingLicenseCategories: row.existingLicenseCategories ?? null,
      existingLicenseCategoriesParsed,
      existingLicenseExpiry: row.existingLicenseExpiry ?? null,
      existingLicenseIssueDate: row.existingLicenseIssueDate ?? null,
      existingLicenseStatus: row.existingLicenseStatus ?? null,
      existingLicenseDocumentType: row.existingLicenseDocumentType ?? null,
      existingLicenseApplicationNumber: row.existingLicenseApplicationNumber ?? null,
      existingLicenseVehicleClass: row.existingLicenseVehicleClass ?? null,
      existingLicenseFetchedAt: row.existingLicenseFetchedAt ?? null,
      requestedLicenseCategory: row.requestedLicenseCategory ?? null,
      preferredExamTime: row.preferredExamTime ?? applicant.preferredExamTime ?? null
    };
  } catch {
    return {
      ...applicant,
      applicationType: APPLICATION_TYPE_FIRST_LICENCE,
      existingLicenseCategoriesParsed: []
    };
  }
}

async function enrichApplicantProvisionalFields(applicant) {
  return enrichApplicantExtendedFields(applicant);
}

function resolveApplicationNumber(applicant) {
  const stored = applicant.applications?.[0]?.applicationNumber;
  if (stored) {
    return stored;
  }

  const application = applicant.applications?.[0];
  const fromError = extractIremboApplicationNumber(applicant.lastError);
  if (!fromError || !isExistingApplicationMessage(applicant.lastError)) {
    return null;
  }

  if (!application?.temporaryBookingId && !application?.examScheduleId) {
    return null;
  }

  return fromError;
}

async function repairDuplicateApplicationNumbers(applicants) {
  const groups = new Map();

  for (const applicant of applicants) {
    const number = resolveApplicationNumber(applicant);
    if (!number) {
      continue;
    }
    if (!groups.has(number)) {
      groups.set(number, []);
    }
    groups.get(number).push(applicant);
  }

  for (const [, group] of groups) {
    if (group.length <= 1) {
      continue;
    }

    const sorted = [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const keeper =
      sorted.find((row) => row.applications?.[0]?.temporaryBookingId) || sorted[0];

    for (const applicant of sorted) {
      if (applicant.id === keeper.id) {
        continue;
      }

      const resetEntityId = null;

      await prisma.applicant.update({
        where: { id: applicant.id },
        data: {
          status: "FAILED_APPLICATION",
          entityId: resetEntityId,
          lastError:
            "Another applicant already received this application number. Each person needs their own Irembo profile — click Retry or set the correct entity ID."
        }
      });

      if (applicant.applications?.[0]) {
        await prisma.application.update({
          where: { id: applicant.applications[0].id },
          data: {
            applicationNumber: null,
            status: "FAILED"
          }
        });
        applicant.applications[0].applicationNumber = null;
        applicant.applications[0].status = "FAILED";
      }

      applicant.status = "FAILED_APPLICATION";
      applicant.entityId = resetEntityId;
      applicant.lastError =
        "Another applicant already received this application number. Each person needs their own Irembo profile — click Retry or set the correct entity ID.";
    }
  }

  return applicants;
}

async function syncApplicantApplicationSuccess(applicant) {
  const applicationNumber = resolveApplicationNumber(applicant);
  if (!applicationNumber) {
    return applicant;
  }

  const failed =
    applicant.status === "FAILED" ||
    applicant.status === "FAILED_APPLICATION" ||
    applicant.status.startsWith("FAILED_");

  if (!failed) {
    return applicant;
  }

  if (!isExistingApplicationMessage(applicant.lastError)) {
    return applicant;
  }

  const application = applicant.applications?.[0];
  if (!application?.temporaryBookingId && !application?.examScheduleId) {
    return applicant;
  }

  await prisma.applicant.update({
    where: { id: applicant.id },
    data: { status: "APPLICATION_CREATED", lastError: null }
  });

  if (applicant.applications?.[0]) {
    await prisma.application.update({
      where: { id: applicant.applications[0].id },
      data: {
        applicationNumber,
        status: "PAYMENT_PENDING"
      }
    });
    applicant.applications[0].applicationNumber = applicationNumber;
    applicant.applications[0].status = "PAYMENT_PENDING";
  }

  applicant.status = "APPLICATION_CREATED";
  applicant.lastError = null;
  return applicant;
}

function serializeApplicant(applicant, includeSensitive = false) {
  const nationalId = includeSensitive ? decryptNationalId(applicant.nationalIdEnc) : undefined;
  const assignedExam = formatAssignedExam(applicant);
  const applicationNumber = resolveApplicationNumber(applicant);

  return {
    id: applicant.id,
    fullName: applicant.fullName,
    nationalId: nationalId ? maskNationalId(nationalId) : maskNationalId("********"),
    nationalIdFull: nationalId,
    dateOfBirth: applicant.dateOfBirth ? applicant.dateOfBirth.toISOString().slice(0, 10) : null,
    phone: applicant.phone,
    email: applicant.email,
    licenseCategory: applicant.licenseCategory,
    preferredLocation: applicant.preferredLocation,
    examType: applicant.examType,
    examCenter: applicant.examCenter,
    examDate: applicant.examDate ? applicant.examDate.toISOString().slice(0, 10) : null,
    examTime: applicant.examTime,
    preferredExamTime: applicant.preferredExamTime || null,
    assignedExam,
    assignedScheduleId: applicant.assignedScheduleId,
    matchedExamScheduleId: applicant.matchedExamScheduleId,
    batchId: applicant.batchId || null,
    batchName: applicant.batch?.name || null,
    batchStatus: applicant.batch?.status || null,
    batchScheduledAt: applicant.batch?.scheduledAt?.toISOString() || null,
    applicationNumber,
    entityId: applicant.entityId,
    provisionalLicenseNumber: applicant.provisionalLicenseNumber || null,
    provisionalLicenseExpiry: applicant.provisionalLicenseExpiry || null,
    applicationType: applicant.applicationType || APPLICATION_TYPE_FIRST_LICENCE,
    existingLicenseCategory: applicant.existingLicenseCategory || null,
    existingLicenseCategories: applicant.existingLicenseCategoriesParsed || [],
    existingLicenseNumber: applicant.existingLicenseNumber || null,
    existingLicenseStatus: applicant.existingLicenseStatus || null,
    existingLicenseExpiry: applicant.existingLicenseExpiry
      ? new Date(applicant.existingLicenseExpiry).toISOString().slice(0, 10)
      : null,
    existingLicenseIssueDate: applicant.existingLicenseIssueDate
      ? new Date(applicant.existingLicenseIssueDate).toISOString().slice(0, 10)
      : null,
    existingLicenseVehicleClass: applicant.existingLicenseVehicleClass || null,
    requestedLicenseCategory: applicant.requestedLicenseCategory || null,
    status: applicant.status,
    statusHint: statusHint(applicant.status, applicant.lastError, applicationNumber, applicant),
    lastError: applicant.lastError,
    createdAt: applicant.createdAt.toISOString(),
    updatedAt: applicant.updatedAt.toISOString(),
    applications: applicant.applications?.map(serializeApplication) || undefined
  };
}

function serializeApplication(application) {
  return {
    id: application.id,
    applicantId: application.applicantId,
    iremboEntityId: application.iremboEntityId,
    temporaryBookingId: application.temporaryBookingId,
    examScheduleId: application.examScheduleId,
    applicationNumber: application.applicationNumber,
    amount: application.amount,
    status: application.status,
    responseData: application.responseData ? JSON.parse(application.responseData) : null,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    applicant: application.applicant ? serializeApplicant(application.applicant) : undefined
  };
}

export async function createApplicant(input) {
  await ensureDatabaseSchema();
  assertAutomationModels();

  const applicationType = normalizeApplicationType(input.applicationType);
  if (applicationType === APPLICATION_TYPE_ADD_CATEGORY) {
    return createAddCategoryApplicant(input);
  }

  const nationalId = String(input.nationalId).trim();
  const nationalIdHash = hashNationalId(nationalId);
  const provisionalLicenseNumber = String(input.provisionalLicenseNumber || "").trim();
  if (!provisionalLicenseNumber) {
    const error = new Error("Provisional licence number is required (e.g. BUS0103102514054/P).");
    error.statusCode = 400;
    throw error;
  }

  const selectedScheduleId = String(input.selectedScheduleId || "").trim();
  if (!selectedScheduleId) {
    const error = new Error("Please select an available exam slot.");
    error.statusCode = 400;
    throw error;
  }

  let preferredLocation = String(input.preferredLocation || input.location || "").trim();

  const schedule = await prisma.schedule.findUnique({
    where: { scheduleId: selectedScheduleId }
  });

  if (!schedule) {
    const error = new Error("Selected exam slot was not found.");
    error.statusCode = 400;
    throw error;
  }

  if (Number(schedule.remainingCapacity || 0) <= 0) {
    const error = new Error("Selected exam slot is no longer available.");
    error.statusCode = 400;
    throw error;
  }

  if (
    String(schedule.category || "").toUpperCase() !==
    String(input.licenseCategory || "").trim().toUpperCase()
  ) {
    const error = new Error("Selected slot does not match the chosen licence category.");
    error.statusCode = 400;
    throw error;
  }

  preferredLocation = schedule.location || preferredLocation;
  const preferredExamTime = resolvePreferredExamTimeInput(
    input,
    schedule.startDateTime ? formatExamTimeFromDate(schedule.startDateTime) : ""
  );
  if (!preferredExamTime) {
    const error = new Error("Select a desired time.");
    error.statusCode = 400;
    throw error;
  }

  if (!preferredLocation) {
    const error = new Error("Could not determine district from the selected slot.");
    error.statusCode = 400;
    throw error;
  }

  const entityId = requireEntityIdInput(input, input.fullName?.trim() || "Applicant");
  const contact = assertApplicantNotificationContact(input, input.fullName?.trim() || "Applicant");
  const profile = await resolveEntityIdForInput({
    nationalId,
    fullName: input.fullName,
    entityId,
    prefetch: false
  });
  await cacheEntityId(nationalIdHash, entityId, input.fullName?.trim() || null);

  const applicant = await prisma.applicant.create({
    data: peelPreferredExamTime({
      fullName: input.fullName.trim(),
      nationalIdEnc: encryptNationalId(nationalId),
      nationalIdHash,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: contact.notificationPhone,
      email: contact.notificationEmail,
      licenseCategory: input.licenseCategory.trim().toUpperCase(),
      preferredLocation,
      preferredExamTime,
      examType: input.examType?.trim() || "PRACTICAL",
      entityId: profile.entityId,
      status: "WAITING_FOR_SLOT"
    }).prismaData
  });
  await persistPreferredExamTime(applicant.id, preferredExamTime);

  await setApplicantProvisionalLicense(applicant.id, {
    licenseNumber: provisionalLicenseNumber,
    dateOfExpiry: input.provisionalLicenseExpiry || null
  });

  return serializeApplicant(await enrichApplicantProvisionalFields(applicant));
}

async function createAddCategoryApplicant(input) {
  const nationalId = String(input.nationalId).trim();
  if (!input.fullName?.trim() || !input.phone?.trim()) {
    const error = new Error("Full name and phone are required.");
    error.statusCode = 400;
    throw error;
  }
  const nationalIdHash = hashNationalId(nationalId);
  const requestedLicenseCategory = String(input.requestedLicenseCategory || input.licenseCategory || "")
    .trim()
    .toUpperCase();
  if (!requestedLicenseCategory) {
    const error = new Error("Select the new category being requested.");
    error.statusCode = 400;
    throw error;
  }

  const existingCategories =
    Array.isArray(input.existingLicenseCategories) && input.existingLicenseCategories.length
      ? input.existingLicenseCategories
      : parseVehicleClasses(input.existingLicenseVehicleClass);
  if (applicantOwnsCategory(existingCategories, requestedLicenseCategory)) {
    const error = new Error("Applicant already has this category.");
    error.statusCode = 400;
    throw error;
  }

  const existingLicenseNumber = String(input.existingLicenseNumber || "").trim();
  if (!existingLicenseNumber) {
    const error = new Error("Fetch the existing licence before saving an add-category applicant.");
    error.statusCode = 400;
    throw error;
  }

  const selectedScheduleId = String(input.selectedScheduleId || "").trim();
  if (!selectedScheduleId) {
    const error = new Error("Please select an available exam slot.");
    error.statusCode = 400;
    throw error;
  }

  const resolved = await resolveRequestedSchedule(
    selectedScheduleId,
    requestedLicenseCategory,
    String(input.examCenter || input.preferredCenter || "").trim()
  );
  const contact = assertApplicantNotificationContact(input, input.fullName?.trim() || "Applicant");
  const entityId = await resolveAddCategoryEntityId(input, nationalId, nationalIdHash);

  const applicant = await prisma.applicant.create({
    data: {
      fullName: input.fullName.trim(),
      nationalIdEnc: encryptNationalId(nationalId),
      nationalIdHash,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: contact.notificationPhone,
      email: contact.notificationEmail,
      licenseCategory: requestedLicenseCategory,
      preferredLocation: resolved.preferredLocation,
      examType: input.examType?.trim() || "PRACTICAL",
      entityId,
      status: entityId ? "WAITING_FOR_SLOT" : "PENDING"
    }
  });

  await setApplicantExistingLicense(applicant.id, {
    applicationType: APPLICATION_TYPE_ADD_CATEGORY,
    existingLicenseId: input.existingLicenseId || null,
    existingLicenseNumber,
    existingLicenseCategory: input.existingLicenseCategory || existingCategories[0] || null,
    existingLicenseCategories: JSON.stringify(existingCategories),
    existingLicenseExpiry: input.existingLicenseExpiry ? new Date(input.existingLicenseExpiry) : null,
    existingLicenseIssueDate: input.existingLicenseIssueDate ? new Date(input.existingLicenseIssueDate) : null,
    existingLicenseStatus: input.existingLicenseStatus || "ACTIVE",
    existingLicenseDocumentType: input.existingLicenseDocumentType || "DEFINITIVE",
    existingLicenseApplicationNumber: input.existingLicenseApplicationNumber || null,
    existingLicenseVehicleClass: input.existingLicenseVehicleClass || null,
    requestedLicenseCategory,
    entityId
  });

  return serializeApplicant(await enrichApplicantProvisionalFields(applicant));
}

async function resolveAddCategoryEntityId(input, nationalId, nationalIdHash) {
  const manualEntityId = String(input.entityId || "").trim();
  if (manualEntityId) {
    if (!isValidEntityId(manualEntityId)) {
      const error = new Error("Entity ID must be the UUID from Irembo profileDto.entityId.");
      error.statusCode = 400;
      throw error;
    }
    await cacheEntityId(nationalIdHash, manualEntityId, input.fullName?.trim() || null);
    return manualEntityId;
  }

  const firstName = String(input.existingLicenseFirstName || "").trim();
  const lastName = String(input.existingLicenseLastName || "").trim();
  const profile = await tryResolveEntityIdForExistingLicense({
    nationalId,
    fullName: input.fullName,
    existingLicense:
      firstName || lastName
        ? { firstName, lastName }
        : input.existingLicenseNumber
          ? {
              firstName,
              lastName,
              licenseNumber: input.existingLicenseNumber
            }
          : null
  });
  if (profile?.entityId) {
    await cacheEntityId(nationalIdHash, profile.entityId, profile.displayName || input.fullName?.trim() || null);
    return profile.entityId;
  }

  return null;
}

async function createAddCategoryApplicantForBulk(input, batchId) {
  const selectedScheduleId = String(input.selectedScheduleId || "").trim();
  const preferredLocationInput = String(input.preferredLocation || "").trim();
  const preferredCenterInput = String(input.examCenter || input.preferredCenter || "").trim();
  const preferredExamTimeInput = resolvePreferredExamTimeInput(input);
  const isEstimateEntry = !selectedScheduleId;

  const nationalId = String(input.nationalId || "").trim();
  const label = input.fullName?.trim() || "Applicant";
  if (!input.fullName?.trim() || !input.phone?.trim() || !nationalId) {
    const error = new Error("Each bulk applicant needs full name, national ID, and phone.");
    error.statusCode = 400;
    throw error;
  }

  const requestedLicenseCategory = String(input.requestedLicenseCategory || input.licenseCategory || "")
    .trim()
    .toUpperCase();
  if (!requestedLicenseCategory) {
    const error = new Error(`${label}: Select the requested category.`);
    error.statusCode = 400;
    throw error;
  }

  const existingCategories =
    Array.isArray(input.existingLicenseCategories) && input.existingLicenseCategories.length
      ? input.existingLicenseCategories
      : parseVehicleClasses(input.existingLicenseVehicleClass);
  if (applicantOwnsCategory(existingCategories, requestedLicenseCategory)) {
    const error = new Error(`${label}: Applicant already has this category.`);
    error.statusCode = 400;
    throw error;
  }

  const existingLicenseNumber = String(input.existingLicenseNumber || "").trim();
  if (!existingLicenseNumber) {
    const error = new Error(`${label}: Fetch the existing licence before saving.`);
    error.statusCode = 400;
    throw error;
  }

  const nationalIdHash = hashNationalId(nationalId);
  const entityId = await resolveAddCategoryEntityId(input, nationalId, nationalIdHash);
  const contact = assertApplicantNotificationContact(input, label);

  let applicantData;
  if (isEstimateEntry) {
    if (!preferredCenterInput) {
      const error = new Error(`${label}: Select a preferred exam site.`);
      error.statusCode = 400;
      throw error;
    }
    if (!preferredLocationInput) {
      const error = new Error(`${label}: Re-select the exam site so the district is saved.`);
      error.statusCode = 400;
      throw error;
    }
    if (!preferredExamTimeInput) {
      const error = new Error(`${label}: Select a desired time for auto-matching.`);
      error.statusCode = 400;
      throw error;
    }
    applicantData = {
      fullName: input.fullName.trim(),
      nationalIdEnc: encryptNationalId(nationalId),
      nationalIdHash,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: contact.notificationPhone,
      email: contact.notificationEmail,
      licenseCategory: requestedLicenseCategory,
      preferredLocation: preferredLocationInput,
      examType: input.examType?.trim() || "PRACTICAL",
      examCenter: preferredCenterInput,
      preferredExamTime: preferredExamTimeInput,
      examDate: null,
      examTime: null,
      assignedScheduleId: null,
      entityId,
      applicationType: APPLICATION_TYPE_ADD_CATEGORY,
      existingLicenseNumber,
      existingLicenseCategory: input.existingLicenseCategory || existingCategories[0] || null,
      existingLicenseCategories: JSON.stringify(existingCategories),
      requestedLicenseCategory,
      status: entityId ? "WAITING_FOR_SLOT" : "PENDING",
      batchId: Number(batchId),
      lastError: entityId ? null : "Paste Irembo entity ID or wait for profile lookup before automating.",
      matchedExamScheduleId: null
    };
  } else {
    const resolved = await resolveRequestedSchedule(
      selectedScheduleId,
      requestedLicenseCategory,
      preferredCenterInput
    );
    const preferredExamTime = preferredExamTimeInput || resolved.examTime;
    if (!preferredExamTime) {
      const error = new Error(`${label}: Exam time missing from selected slot.`);
      error.statusCode = 400;
      throw error;
    }
    applicantData = {
      fullName: input.fullName.trim(),
      nationalIdEnc: encryptNationalId(nationalId),
      nationalIdHash,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: contact.notificationPhone,
      email: contact.notificationEmail,
      licenseCategory: requestedLicenseCategory,
      preferredLocation: resolved.preferredLocation,
      examType: input.examType?.trim() || "PRACTICAL",
      examCenter: resolved.examCenter,
      examDate: resolved.examDate,
      examTime: resolved.examTime,
      preferredExamTime,
      assignedScheduleId: selectedScheduleId,
      entityId,
      applicationType: APPLICATION_TYPE_ADD_CATEGORY,
      existingLicenseNumber,
      existingLicenseCategory: input.existingLicenseCategory || existingCategories[0] || null,
      existingLicenseCategories: JSON.stringify(existingCategories),
      requestedLicenseCategory,
      status: entityId ? "SAVED" : "PENDING",
      batchId: Number(batchId),
      lastError: entityId ? null : "Paste Irembo entity ID or wait for profile lookup before automating.",
      matchedExamScheduleId: resolveMatchedExamScheduleId(selectedScheduleId)
    };
  }

  const existing = await prisma.applicant.findUnique({
    where: { nationalIdHash },
    include: {
      batch: true,
      applications: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  const licensePayload = {
    applicationType: APPLICATION_TYPE_ADD_CATEGORY,
    existingLicenseId: input.existingLicenseId || null,
    existingLicenseNumber,
    existingLicenseCategory: input.existingLicenseCategory || existingCategories[0] || null,
    existingLicenseCategories: JSON.stringify(existingCategories),
    existingLicenseExpiry: input.existingLicenseExpiry ? new Date(input.existingLicenseExpiry) : null,
    existingLicenseIssueDate: input.existingLicenseIssueDate ? new Date(input.existingLicenseIssueDate) : null,
    existingLicenseStatus: input.existingLicenseStatus || "ACTIVE",
    existingLicenseDocumentType: input.existingLicenseDocumentType || "DEFINITIVE",
    existingLicenseApplicationNumber: input.existingLicenseApplicationNumber || null,
    existingLicenseVehicleClass: input.existingLicenseVehicleClass || null,
    requestedLicenseCategory,
    entityId
  };

  if (existing) {
    if (hasActiveUnpaidApplication(existing)) {
      const applicationNumber = existing.applications?.[0]?.applicationNumber;
      const error = new Error(
        applicationNumber
          ? `This national ID already has an active Irembo application ${applicationNumber}.`
          : "This national ID already has a completed application."
      );
      error.statusCode = 409;
      throw error;
    }
    if (existing.status === "PENDING" && existing.batch?.status === "RUNNING") {
      const error = new Error(`${existing.fullName} is being automated right now. Wait for it to finish first.`);
      error.statusCode = 409;
      throw error;
    }

    const { prismaData, preferredExamTime } = peelPreferredExamTime(applicantData);
    await prisma.applicant.update({
      where: { id: existing.id },
      data: prismaData
    });
    await persistPreferredExamTime(existing.id, preferredExamTime);
    await setApplicantExistingLicense(existing.id, licensePayload);
    return refreshBulkApplicant(existing.id);
  }

  try {
    const { prismaData, preferredExamTime } = peelPreferredExamTime(applicantData);
    const applicant = await prisma.applicant.create({ data: prismaData });
    await persistPreferredExamTime(applicant.id, preferredExamTime);
    await setApplicantExistingLicense(applicant.id, licensePayload);
    return refreshBulkApplicant(applicant.id);
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      const conflict = new Error(
        `${input.fullName.trim()} is already saved. Refresh the bulk list and edit the existing row instead of adding again.`
      );
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
}

function isPrismaUniqueViolation(error, field = "nationalIdHash") {
  const message = String(error?.message || "");
  return message.includes("Unique constraint failed") && message.includes(field);
}

function assertApplicantNotificationContact(input, label = "Applicant") {
  try {
    return resolveIremboNotificationContact({
      phone: input.phone,
      email: input.email
    });
  } catch (error) {
    const wrapped = new Error(`${label}: ${error.message}`);
    wrapped.statusCode = 400;
    throw wrapped;
  }
}

async function refreshBulkApplicant(applicantId) {
  const refreshed = await prisma.applicant.findUnique({
    where: { id: Number(applicantId) },
    include: {
      batch: true,
      applications: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  return serializeApplicant(await enrichApplicantProvisionalFields(refreshed));
}

export async function createApplicantForBulk(input, batchId) {
  await ensureDatabaseSchema();
  assertAutomationModels();

  const applicationType = normalizeApplicationType(input.applicationType);
  if (applicationType === APPLICATION_TYPE_ADD_CATEGORY) {
    return createAddCategoryApplicantForBulk(input, batchId);
  }

  const selectedScheduleId = String(input.selectedScheduleId || "").trim();
  const preferredLocationInput = String(input.preferredLocation || "").trim();
  const preferredCenterInput = String(input.examCenter || input.preferredCenter || "").trim();
  const preferredExamTimeInput = resolvePreferredExamTimeInput(input);
  const isEstimateEntry = !selectedScheduleId;

  const nationalId = String(input.nationalId).trim();
  const provisionalLicenseNumber = String(input.provisionalLicenseNumber || "").trim();
  if (!provisionalLicenseNumber) {
    const error = new Error("Provisional licence number is required for each bulk applicant.");
    error.statusCode = 400;
    throw error;
  }
  if (!input.fullName?.trim() || !input.phone?.trim() || !nationalId) {
    const error = new Error("Each bulk applicant needs full name, national ID, and phone.");
    error.statusCode = 400;
    throw error;
  }

  const licenseCategory = String(input.licenseCategory || "A").trim().toUpperCase();
  const label = input.fullName?.trim() || "Applicant";
  const entityId = requireEntityIdInput(input, label);
  const contact = assertApplicantNotificationContact(input, label);
  const profile = await resolveEntityIdForInput({
    nationalId,
    fullName: input.fullName,
    entityId,
    prefetch: false
  });
  const nationalIdHash = hashNationalId(nationalId);
  await cacheEntityId(nationalIdHash, entityId, input.fullName?.trim() || null);

  let applicantData;
  if (isEstimateEntry) {
    if (!preferredCenterInput) {
      const error = new Error(`${label}: Select a preferred exam site.`);
      error.statusCode = 400;
      throw error;
    }
    if (!preferredLocationInput) {
      const error = new Error(`${label}: Re-select the exam site so the district is saved.`);
      error.statusCode = 400;
      throw error;
    }
    if (!preferredExamTimeInput) {
      const error = new Error(`${label}: Select a desired time for auto-matching.`);
      error.statusCode = 400;
      throw error;
    }
    applicantData = {
      fullName: input.fullName.trim(),
      nationalIdEnc: encryptNationalId(nationalId),
      nationalIdHash,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: contact.notificationPhone,
      email: contact.notificationEmail,
      licenseCategory,
      preferredLocation: preferredLocationInput,
      examType: input.examType?.trim() || "PRACTICAL",
      examCenter: preferredCenterInput,
      preferredExamTime: preferredExamTimeInput,
      examDate: null,
      examTime: null,
      assignedScheduleId: null,
      entityId: profile.entityId,
      status: "WAITING_FOR_SLOT",
      batchId: Number(batchId),
      lastError: null,
      matchedExamScheduleId: null
    };
  } else {
    const resolved = await resolveRequestedSchedule(
      selectedScheduleId,
      licenseCategory,
      preferredCenterInput
    );
    const preferredExamTime = preferredExamTimeInput || resolved.examTime;
    if (!preferredExamTime) {
      const error = new Error(`${label}: Exam time missing from selected slot.`);
      error.statusCode = 400;
      throw error;
    }
    applicantData = {
      fullName: input.fullName.trim(),
      nationalIdEnc: encryptNationalId(nationalId),
      nationalIdHash,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
      phone: contact.notificationPhone,
      email: contact.notificationEmail,
      licenseCategory,
      preferredLocation: resolved.preferredLocation,
      examType: input.examType?.trim() || "PRACTICAL",
      examCenter: resolved.examCenter,
      examDate: resolved.examDate,
      examTime: resolved.examTime,
      preferredExamTime,
      assignedScheduleId: selectedScheduleId,
      entityId: profile.entityId,
      status: "SAVED",
      batchId: Number(batchId),
      lastError: null,
      matchedExamScheduleId: resolveMatchedExamScheduleId(selectedScheduleId)
    };
  }

  const existing = await prisma.applicant.findUnique({
    where: { nationalIdHash },
    include: {
      batch: true,
      applications: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  if (existing) {
    if (hasActiveUnpaidApplication(existing)) {
      const applicationNumber = existing.applications?.[0]?.applicationNumber;
      const error = new Error(
        applicationNumber
          ? `This national ID already has an active Irembo application ${applicationNumber}.`
          : "This national ID already has a completed application."
      );
      error.statusCode = 409;
      throw error;
    }
    if (existing.status === "PENDING") {
      const error = new Error(`${existing.fullName} is being automated right now. Wait for it to finish first.`);
      error.statusCode = 409;
      throw error;
    }

    const { prismaData, preferredExamTime } = peelPreferredExamTime(applicantData);
    await prisma.applicant.update({
      where: { id: existing.id },
      data: prismaData
    });
    await persistPreferredExamTime(existing.id, preferredExamTime);
    await setApplicantProvisionalLicense(existing.id, {
      licenseNumber: provisionalLicenseNumber,
      dateOfExpiry: input.provisionalLicenseExpiry || null
    });
    return refreshBulkApplicant(existing.id);
  }

  try {
    const { prismaData, preferredExamTime } = peelPreferredExamTime(applicantData);
    const applicant = await prisma.applicant.create({ data: prismaData });
    await persistPreferredExamTime(applicant.id, preferredExamTime);
    await setApplicantProvisionalLicense(applicant.id, {
      licenseNumber: provisionalLicenseNumber,
      dateOfExpiry: input.provisionalLicenseExpiry || null
    });
    return refreshBulkApplicant(applicant.id);
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      const conflict = new Error(
        `${input.fullName.trim()} is already saved. Refresh the bulk list and edit the existing row instead of adding again.`
      );
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
}

export async function updateBulkDraftApplicant(id, input) {
  await ensureDatabaseSchema();
  const existing = await prisma.applicant.findUnique({
    where: { id: Number(id) },
    include: { batch: true }
  });

  if (!existing) {
    const error = new Error("Applicant not found.");
    error.statusCode = 404;
    throw error;
  }
  if (existing.batch?.status !== "DRAFT" || !["SAVED", "WAITING_FOR_SLOT"].includes(existing.status)) {
    const error = new Error("Only saved bulk-list applicants can be edited here.");
    error.statusCode = 400;
    throw error;
  }

  const licenseCategory =
    input.licenseCategory !== undefined
      ? String(input.licenseCategory).trim().toUpperCase()
      : existing.licenseCategory;
  const selectedScheduleId = String(
    input.selectedScheduleId !== undefined ? input.selectedScheduleId : existing.assignedScheduleId || ""
  ).trim();
  const preferredLocationInput = String(
    input.preferredLocation !== undefined ? input.preferredLocation : existing.preferredLocation || ""
  ).trim();
  const preferredCenterInput = String(
    input.examCenter !== undefined ? input.examCenter : existing.examCenter || ""
  ).trim();
  const isEstimateEntry = !selectedScheduleId;
  const nationalIdForProfile =
    input.nationalId !== undefined ? String(input.nationalId).trim() : decryptNationalId(existing.nationalIdEnc);
  const fullName =
    input.fullName !== undefined ? input.fullName.trim() : existing.fullName;
  const entityId = requireEntityIdInput(
    { entityId: input.entityId !== undefined ? input.entityId : existing.entityId },
    fullName
  );
  const profile = await resolveEntityIdForInput({
    nationalId: nationalIdForProfile,
    fullName,
    entityId,
    prefetch: false
  });
  if (nationalIdForProfile) {
    await cacheEntityId(hashNationalId(nationalIdForProfile), entityId, fullName);
  }

  const contact = assertApplicantNotificationContact(
    {
      phone: input.phone !== undefined ? input.phone : existing.phone,
      email: input.email !== undefined ? input.email : existing.email
    },
    fullName
  );

  const data = {
    fullName: input.fullName !== undefined ? input.fullName.trim() : existing.fullName,
    phone: contact.notificationPhone,
    email: contact.notificationEmail,
    licenseCategory,
    entityId: profile.entityId
  };

  if (isEstimateEntry) {
    if (!preferredCenterInput) {
      const error = new Error("Select a preferred exam site.");
      error.statusCode = 400;
      throw error;
    }
    if (!preferredLocationInput) {
      const error = new Error("Re-select the exam site so the district is saved.");
      error.statusCode = 400;
      throw error;
    }
    const preferredExamTimeInput = resolvePreferredExamTimeInput(
      input,
      existing.preferredExamTime || (await loadPreferredExamTime(existing.id)) || ""
    );
    if (!preferredExamTimeInput) {
      const error = new Error("Select a desired time for auto-matching.");
      error.statusCode = 400;
      throw error;
    }
    Object.assign(data, {
      preferredLocation: preferredLocationInput,
      examCenter: preferredCenterInput,
      preferredExamTime: preferredExamTimeInput,
      examDate: null,
      examTime: null,
      assignedScheduleId: null,
      matchedExamScheduleId: null,
      status: "WAITING_FOR_SLOT"
    });
  } else {
    const resolved = await resolveRequestedSchedule(
      selectedScheduleId,
      licenseCategory,
      preferredCenterInput
    );
    const preferredExamTime = resolvePreferredExamTimeInput(input, resolved.examTime);
    if (!preferredExamTime) {
      const error = new Error("Select a desired time.");
      error.statusCode = 400;
      throw error;
    }
    Object.assign(data, {
      preferredLocation: resolved.preferredLocation,
      examCenter: resolved.examCenter,
      examDate: resolved.examDate,
      examTime: resolved.examTime,
      preferredExamTime,
      assignedScheduleId: selectedScheduleId,
      matchedExamScheduleId: resolveMatchedExamScheduleId(selectedScheduleId),
      status: "SAVED"
    });
  }

  if (input.dateOfBirth !== undefined) {
    data.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
  }
  if (input.nationalId !== undefined) {
    data.nationalIdEnc = encryptNationalId(input.nationalId);
    data.nationalIdHash = hashNationalId(input.nationalId);
  }

  const { prismaData, preferredExamTime } = peelPreferredExamTime(data);
  await prisma.applicant.update({
    where: { id: existing.id },
    data: prismaData
  });
  await persistPreferredExamTime(existing.id, preferredExamTime);

  if (input.provisionalLicenseNumber !== undefined || input.provisionalLicenseExpiry !== undefined) {
    await setApplicantProvisionalLicense(existing.id, {
      licenseNumber: input.provisionalLicenseNumber,
      dateOfExpiry: input.provisionalLicenseExpiry
    });
  }

  const refreshed = await prisma.applicant.findUnique({
    where: { id: existing.id },
    include: { batch: true, applications: { orderBy: { createdAt: "desc" }, take: 1 } }
  });

  return serializeApplicant(await enrichApplicantProvisionalFields(refreshed));
}

export async function deleteBulkDraftApplicant(id) {
  await ensureDatabaseSchema();
  const existing = await prisma.applicant.findUnique({
    where: { id: Number(id) },
    include: { batch: true }
  });

  if (!existing) {
    const error = new Error("Applicant not found.");
    error.statusCode = 404;
    throw error;
  }
  if (existing.batch?.status !== "DRAFT") {
    const error = new Error("Only applicants on a draft bulk list can be removed here.");
    error.statusCode = 400;
    throw error;
  }
  if (!["SAVED", "PENDING", "WAITING_FOR_SLOT"].includes(existing.status)) {
    const error = new Error("This applicant can no longer be removed from the draft list.");
    error.statusCode = 400;
    throw error;
  }

  await deleteApplicant(existing.id);
  return { ok: true };
}

export async function updateApplicant(id, input) {
  const data = {};
  if (input.fullName !== undefined) data.fullName = input.fullName.trim();
  if (input.dateOfBirth !== undefined) data.dateOfBirth = input.dateOfBirth ? new Date(input.dateOfBirth) : null;
  if (input.phone !== undefined) data.phone = input.phone.trim();
  if (input.email !== undefined) data.email = String(input.email || "").trim();
  if (input.licenseCategory !== undefined) data.licenseCategory = input.licenseCategory.trim().toUpperCase();
  if (input.preferredLocation !== undefined || input.location !== undefined) {
    data.preferredLocation = String(input.preferredLocation || input.location || "").trim();
  }
  if (input.examType !== undefined) data.examType = input.examType.trim();
  if (input.entityId !== undefined) {
    const entityId = requireEntityIdInput(
      { entityId: input.entityId },
      input.fullName || "Applicant"
    );
    data.entityId = entityId;
  }
  if (input.nationalId !== undefined) {
    data.nationalIdEnc = encryptNationalId(input.nationalId);
    data.nationalIdHash = hashNationalId(input.nationalId);
  }

  let applicant = await prisma.applicant.update({
    where: { id: Number(id) },
    data
  });

  if (input.provisionalLicenseNumber !== undefined || input.provisionalLicenseExpiry !== undefined) {
    await setApplicantProvisionalLicense(Number(id), {
      licenseNumber: input.provisionalLicenseNumber ?? applicant.provisionalLicenseNumber,
      dateOfExpiry: input.provisionalLicenseExpiry ?? applicant.provisionalLicenseExpiry
    });
    applicant = await enrichApplicantProvisionalFields(
      await prisma.applicant.findUnique({ where: { id: Number(id) } })
    );
  }

  return serializeApplicant(applicant);
}

export async function assignScheduleToApplicant(applicantId, assignment) {
  const examScheduleId = assignment.examScheduleId
    ? extractRawScheduleId(assignment.examScheduleId)
    : extractRawScheduleId(assignment.assignedScheduleId);

  const preferredLocation = String(
    assignment.preferredLocation || assignment.locationName || assignment.location || ""
  ).trim();

  const applicant = await prisma.applicant.update({
    where: { id: Number(applicantId) },
    data: {
      examCenter: assignment.examCenter || "",
      examDate: assignment.examDate ? new Date(assignment.examDate) : null,
      examTime: assignment.examTime || "",
      ...(preferredLocation ? { preferredLocation } : {}),
      assignedScheduleId: assignment.assignedScheduleId || null,
      status: "PENDING",
      lastError: null
    }
  });

  if (examScheduleId && isBookableScheduleId(examScheduleId)) {
    try {
      return await prisma.applicant.update({
        where: { id: Number(applicantId) },
        data: { matchedExamScheduleId: examScheduleId }
      });
    } catch {
      await prisma.$executeRawUnsafe(`
        UPDATE "Applicant"
        SET "matchedExamScheduleId" = '${examScheduleId.replaceAll("'", "''")}',
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${Number(applicantId)}
      `);
      return prisma.applicant.findUnique({ where: { id: Number(applicantId) } });
    }
  }

  return applicant;
}

export async function resetApplicantForRetry(id) {
  await ensureDatabaseSchema();
  const applicantId = Number(id);
  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET
      "status" = 'WAITING_FOR_SLOT',
      "lastError" = NULL,
      "entityId" = CASE
        WHEN "entityId" = '${DEFAULT_IREMBO_ENTITY_ID.replaceAll("'", "''")}' THEN NULL
        ELSE "entityId"
      END,
      "examCenter" = '',
      "examTime" = '',
      "examDate" = NULL,
      "assignedScheduleId" = NULL,
      "matchedExamScheduleId" = NULL,
      "lastFailedScheduleId" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${applicantId}
  `);
  return prisma.applicant.findUnique({ where: { id: applicantId } });
}

export async function clearApplicantAssignment(id, lastError = null) {
  await ensureDatabaseSchema();
  const applicantId = Number(id);
  const safeError = lastError ? `'${String(lastError).replaceAll("'", "''")}'` : "NULL";
  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET
      "status" = 'WAITING_FOR_SLOT',
      "lastError" = ${safeError},
      "examCenter" = '',
      "examTime" = '',
      "examDate" = NULL,
      "assignedScheduleId" = NULL,
      "matchedExamScheduleId" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${applicantId}
  `);
  return prisma.applicant.findUnique({ where: { id: applicantId } });
}

export async function deleteApplicant(id) {
  await prisma.applicant.delete({ where: { id: Number(id) } });
  return { ok: true };
}

export async function listWaitingApplicants() {
  await ensureDatabaseSchema();
  assertAutomationModels();
  return prisma.applicant.findMany({
    where: { status: "WAITING_FOR_SLOT" },
    orderBy: { createdAt: "asc" }
  });
}

export async function listApplicants() {
  await ensureDatabaseSchema();
  assertAutomationModels();
  await repairStuckProfileApplicants().catch(() => 0);
  await prisma.applicant.updateMany({
    where: {
      status: "PENDING",
      batch: { status: "DRAFT" }
    },
    data: {
      status: "SAVED",
      matchedExamScheduleId: null,
      lastError: null
    }
  });

  await prisma.applicant.updateMany({
    where: { status: "FETCHING_PROFILE" },
    data: {
      status: "FAILED_LOOKUP",
      lastError: "Profile was not verified at save time. Remove this applicant and add again."
    }
  });

  const applicants = await prisma.applicant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      batch: true,
      applications: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  const enriched = await Promise.all(applicants.map((applicant) => enrichApplicantProvisionalFields(applicant)));
  await repairDuplicateApplicationNumbers(enriched);
  const synced = await Promise.all(enriched.map((applicant) => syncApplicantApplicationSuccess(applicant)));

  // Refresh unpaid codes from Irembo so expired applications are not treated as still active.
  try {
    const { syncApplicantPaymentStatusesFromIrembo } = await import("./applicationService.js");
    await syncApplicantPaymentStatusesFromIrembo(synced);
  } catch {
    // Keep local list if Irembo sync is temporarily unavailable.
  }

  const refreshed = await prisma.applicant.findMany({
    where: { id: { in: synced.map((row) => row.id) } },
    orderBy: { createdAt: "desc" },
    include: {
      batch: true,
      applications: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });
  const byId = new Map(refreshed.map((row) => [row.id, row]));
  return synced.map((applicant) => serializeApplicant(byId.get(applicant.id) || applicant));
}

export async function listAutomationQueueApplicants() {
  const applicants = await listApplicants();
  return applicants.filter((applicant) => {
    // Draft bulk-list rows stay on the bulk page until Automate Codes is clicked.
    if (applicant.batchStatus === "DRAFT" && applicant.status === "SAVED") {
      return false;
    }
    return true;
  });
}

export async function getApplicantById(id, includeSensitive = false) {
  const applicant = await prisma.applicant.findUnique({
    where: { id: Number(id) },
    include: {
      applications: { orderBy: { createdAt: "desc" } },
      automationLogs: { orderBy: { createdAt: "desc" }, take: 20 }
    }
  });

  if (!applicant) {
    return null;
  }

  const enriched = await enrichApplicantProvisionalFields(applicant);

  return {
    ...serializeApplicant(enriched, includeSensitive),
    applications: enriched.applications.map(serializeApplication),
    automationLogs: applicant.automationLogs
  };
}

export async function setApplicantStatus(id, status, lastError = null) {
  return prisma.applicant.update({
    where: { id: Number(id) },
    data: { status, lastError }
  });
}

export async function setApplicantEntityId(id, entityId) {
  return prisma.applicant.update({
    where: { id: Number(id) },
    data: { entityId }
  });
}

export async function setApplicantProvisionalLicense(id, license) {
  await ensureDatabaseSchema();
  const applicantId = Number(id);
  const licenseNumber = String(license.licenseNumber || "").replaceAll("'", "''");
  const licenseExpiry = license.dateOfExpiry
    ? `'${String(license.dateOfExpiry).replaceAll("'", "''")}'`
    : "NULL";

  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET
      "provisionalLicenseNumber" = '${licenseNumber}',
      "provisionalLicenseExpiry" = ${licenseExpiry},
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${applicantId}
  `);

  return enrichApplicantProvisionalFields(
    await prisma.applicant.findUnique({ where: { id: applicantId } })
  );
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") {
    return "NULL";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function peelPreferredExamTime(data) {
  if (!data || !Object.prototype.hasOwnProperty.call(data, "preferredExamTime")) {
    return { prismaData: data, preferredExamTime: undefined };
  }
  const { preferredExamTime, ...prismaData } = data;
  return { prismaData, preferredExamTime };
}

async function persistPreferredExamTime(applicantId, preferredExamTime) {
  if (preferredExamTime === undefined) {
    return;
  }
  await ensureDatabaseSchema();
  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET "preferredExamTime" = ${sqlString(preferredExamTime || null)},
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${Number(applicantId)}
  `);
}

async function loadPreferredExamTime(applicantId) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "preferredExamTime"
    FROM "Applicant"
    WHERE "id" = ${Number(applicantId)}
    LIMIT 1
  `);
  return rows[0]?.preferredExamTime || null;
}

function sqlDateTime(value) {
  if (!value) {
    return "NULL";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "NULL";
  }
  return `'${date.toISOString()}'`;
}

export async function setApplicantExistingLicense(id, data = {}) {
  await ensureDatabaseSchema();
  const applicantId = Number(id);
  const sets = [`"updatedAt" = CURRENT_TIMESTAMP`];

  if (data.applicationType !== undefined) {
    sets.push(`"applicationType" = ${sqlString(data.applicationType)}`);
  }
  if (data.fullName !== undefined) {
    sets.push(`"fullName" = ${sqlString(data.fullName)}`);
  }
  if (data.entityId !== undefined) {
    sets.push(`"entityId" = ${sqlString(data.entityId)}`);
  }
  if (data.existingLicenseId !== undefined) {
    sets.push(`"existingLicenseId" = ${sqlString(data.existingLicenseId)}`);
  }
  if (data.existingLicenseNumber !== undefined) {
    sets.push(`"existingLicenseNumber" = ${sqlString(data.existingLicenseNumber)}`);
  }
  if (data.existingLicenseCategory !== undefined) {
    sets.push(`"existingLicenseCategory" = ${sqlString(data.existingLicenseCategory)}`);
  }
  if (data.existingLicenseCategories !== undefined) {
    sets.push(`"existingLicenseCategories" = ${sqlString(data.existingLicenseCategories)}`);
  }
  if (data.existingLicenseExpiry !== undefined) {
    sets.push(`"existingLicenseExpiry" = ${sqlDateTime(data.existingLicenseExpiry)}`);
  }
  if (data.existingLicenseIssueDate !== undefined) {
    sets.push(`"existingLicenseIssueDate" = ${sqlDateTime(data.existingLicenseIssueDate)}`);
  }
  if (data.existingLicenseStatus !== undefined) {
    sets.push(`"existingLicenseStatus" = ${sqlString(data.existingLicenseStatus)}`);
  }
  if (data.existingLicenseDocumentType !== undefined) {
    sets.push(`"existingLicenseDocumentType" = ${sqlString(data.existingLicenseDocumentType)}`);
  }
  if (data.existingLicenseApplicationNumber !== undefined) {
    sets.push(`"existingLicenseApplicationNumber" = ${sqlString(data.existingLicenseApplicationNumber)}`);
  }
  if (data.existingLicenseVehicleClass !== undefined) {
    sets.push(`"existingLicenseVehicleClass" = ${sqlString(data.existingLicenseVehicleClass)}`);
  }
  if (data.requestedLicenseCategory !== undefined) {
    sets.push(`"requestedLicenseCategory" = ${sqlString(data.requestedLicenseCategory)}`);
    sets.push(`"licenseCategory" = ${sqlString(String(data.requestedLicenseCategory).toUpperCase())}`);
  }
  sets.push(`"existingLicenseFetchedAt" = CURRENT_TIMESTAMP`);

  await prisma.$executeRawUnsafe(`
    UPDATE "Applicant"
    SET ${sets.join(", ")}
    WHERE "id" = ${applicantId}
  `);

  return enrichApplicantProvisionalFields(
    await prisma.applicant.findUnique({ where: { id: applicantId } })
  );
}

export { serializeApplication, hasAssignedExam };
