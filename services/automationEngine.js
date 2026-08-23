import { logger } from "../lib/logger.js";
import { isTestMode } from "../lib/automationConfig.js";
import { withApplicantAutomationLock, markApplicantRateLimited, shouldDeferAutomation, consumeForceAutomationRun, clearAutomationCooldown } from "../lib/applicantAutomationLock.js";
import { isApplicantHeldForBatch } from "../lib/bulkAutomationHold.js";
import { appendFailedScheduleId } from "../lib/failedSchedules.js";
import { extractRawScheduleId, isBookableScheduleId } from "../lib/scheduleIds.js";
import { examCentersMatch } from "../lib/examCenters.js";
import {
  buildExamScheduleDate,
  createDrivingLicenseApplication,
  findExamSchedule,
  getCitizenProfile,
  listBookableSchedulesForApplicant,
  reserveTemporarySlot,
  SUPPLEMENTARY_SERVICE_CODE,
  validateDefinitiveLicense
} from "../providers/iremboApplicationProvider.js";
import {
  assignScheduleToApplicant,
  clearApplicantAssignment,
  getApplicantById,
  hasAssignedExam,
  setApplicantEntityId,
  setApplicantProvisionalLicense,
  setApplicantStatus
} from "../services/applicantService.js";
import {
  createApplicationRecord,
  getLatestApplicationForApplicant,
  updateApplicationRecord
} from "../services/applicationService.js";
import { logAutomationEvent } from "../services/automationLogService.js";
import { sendApplicationCreatedNotification } from "../services/automationNotificationService.js";
import { getFailedScheduleIds, isScheduleBlocked } from "../lib/failedSchedules.js";
import { lookupEntityIdFromIrembo, markProfileLookupRateLimited } from "./entityIdService.js";
import {
  isExistingLicenseApplicant,
  resolveAutomationLicenseCategory,
  resolveAutomationLicenseNumber
} from "./existingLicenseService.js";
import { normalizeRwandaPhone } from "../lib/iremboContact.js";

function resolveAssignedSchedule(applicantRecord) {
  if (!hasAssignedExam(applicantRecord)) {
    throw new Error("No exam slot assigned yet. Waiting for a matching detected schedule.");
  }

  return {
    examCenter: applicantRecord.examCenter,
    examDate: applicantRecord.examDate,
    examTime: applicantRecord.examTime
  };
}

function isSlotUnavailableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("423") ||
    message.includes("locked") ||
    message.includes("no longer available") ||
    message.includes("no live schedule found") ||
    message.includes("bookable") ||
    message.includes("gahunda yibizamini") ||
    message.includes("irimo ikosa") ||
    message.includes("schedule error") ||
    message.includes("trying the next open slot") ||
    message.includes("schedule has an error") ||
    message.includes("all candidate schedules") ||
    message.includes("rejected by irembo")
  );
}

function isValidationError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("invalid `prisma.") || message.includes("unknown argument")) {
    return false;
  }
  return (
    message.includes("definitive validation") ||
    message.includes("validate definitivelicense") ||
    message.includes("provisional licence number")
  );
}

function classifyFailure(error) {
  const message = String(error?.message || "");
  if (message.includes("Unknown argument") || message.includes("Invalid `prisma.")) {
    return "FAILED";
  }
  if (isRateLimitError(error)) {
    return "FAILED_LOOKUP";
  }
  if (isValidationError(error)) {
    return "FAILED_VALIDATION";
  }
  if (isSlotUnavailableError(error)) {
    return "FAILED_BOOKING";
  }
  if (String(error?.message || "").includes("application")) {
    return "FAILED_APPLICATION";
  }
  return "FAILED";
}

async function resolveCitizenProfile(applicantRecord, nationalId) {
  if (applicantRecord.entityId) {
    logger.info("Using stored citizen entityId", { applicantId: applicantRecord.id });
    return { entityId: applicantRecord.entityId, displayName: applicantRecord.fullName };
  }

  const profile = await getCitizenProfile(nationalId, { fullName: applicantRecord.fullName });
  await logAutomationEvent({
    applicantId: applicantRecord.id,
    action: "GET_CITIZEN_PROFILE",
    requestPayload: { nationalId: "***", fullName: applicantRecord.fullName },
    responsePayload: profile,
    success: true
  });
  await setApplicantEntityId(applicantRecord.id, profile.entityId);
  return profile;
}

async function resolveLicenseForApplication(applicantRecord, nationalId) {
  if (isExistingLicenseApplicant(applicantRecord)) {
    const licenseNumber = resolveAutomationLicenseNumber(applicantRecord);
    if (!licenseNumber) {
      throw new Error("Existing licence number is missing. Fetch the existing licence before automating.");
    }
    logger.info("Using stored existing definitive licence", {
      applicantId: applicantRecord.id,
      licenseNumber
    });
    return {
      licenseNumber,
      dateOfExpiry: applicantRecord.existingLicenseExpiry
        ? new Date(applicantRecord.existingLicenseExpiry).toLocaleDateString("en-GB")
        : null
    };
  }

  if (applicantRecord.provisionalLicenseNumber) {
    logger.info("Using stored provisional licence", {
      applicantId: applicantRecord.id,
      licenseNumber: applicantRecord.provisionalLicenseNumber
    });
    return {
      licenseNumber: applicantRecord.provisionalLicenseNumber,
      dateOfExpiry: applicantRecord.provisionalLicenseExpiry
    };
  }

  const license = await validateDefinitiveLicense(nationalId);
  await logAutomationEvent({
    applicantId: applicantRecord.id,
    action: "VALIDATE_DEFINITIVE_LICENSE",
    requestPayload: { nationalId: "***" },
    responsePayload: license,
    success: true
  });
  await setApplicantProvisionalLicense(applicantRecord.id, license);
  return license;
}

function isRateLimitError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("423") ||
    message.includes("rate limit") ||
    message.includes("temporarily busy") ||
    message.includes("blocking profile lookups") ||
    message.includes("getcitizenprofile timed out") ||
    message.includes("cooling down") ||
    message.includes("auto-retry")
  );
}

async function reserveFirstAvailableSchedule(applicantRecord, assignedSchedule, failedScheduleIds) {
  const bookingContext = {
    category: resolveAutomationLicenseCategory(applicantRecord),
    location: applicantRecord.preferredLocation
  };

  let lastError = null;
  const triedIds = new Set();
  const maxAlternateAttempts = 2;

  async function attemptReserve(candidate) {
    if (
      !candidate?.examScheduleId ||
      triedIds.has(candidate.examScheduleId) ||
      isScheduleBlocked(candidate.examScheduleId, failedScheduleIds)
    ) {
      return null;
    }

    const preferredCenter = String(assignedSchedule.examCenter || applicantRecord.examCenter || "").trim();
    if (
      preferredCenter &&
      candidate.examCenter &&
      !examCentersMatch(candidate.examCenter, preferredCenter)
    ) {
      return null;
    }

    const preferredLocation = String(applicantRecord.preferredLocation || "").trim();
    if (
      preferredLocation &&
      candidate.locationName &&
      preferredLocation.toLowerCase() !== String(candidate.locationName).trim().toLowerCase()
    ) {
      return null;
    }

    triedIds.add(candidate.examScheduleId);
    try {
      const temporaryBookingId = await reserveTemporarySlot(candidate.examScheduleId, bookingContext);
      return {
        examScheduleId: candidate.examScheduleId,
        temporaryBookingId,
        examCenter: candidate.examCenter || assignedSchedule.examCenter,
        examDate: candidate.examDate || assignedSchedule.examDate,
        examTime: candidate.examTime || assignedSchedule.examTime,
        locationName: candidate.locationName || candidate.schedule?.locationName || applicantRecord.preferredLocation,
        amount: candidate.amount ?? candidate.schedule?.price ?? candidate.schedule?.examFee ?? null
      };
    } catch (error) {
      lastError = error;
      await appendFailedScheduleId(applicantRecord.id, candidate.examScheduleId);
      logger.warn("Schedule reserve attempt failed", {
        applicantId: applicantRecord.id,
        examScheduleId: candidate.examScheduleId,
        message: error.message
      });
      return null;
    }
  }

  try {
    const assignedGuid = extractRawScheduleId(
      applicantRecord.matchedExamScheduleId || applicantRecord.assignedScheduleId
    );
    if (isBookableScheduleId(assignedGuid)) {
      const direct = await attemptReserve({
        examScheduleId: assignedGuid,
        examCenter: assignedSchedule.examCenter,
        examDate: assignedSchedule.examDate,
        examTime: assignedSchedule.examTime
      });
      if (direct) {
        return direct;
      }
    }

    const liveAssigned = await findExamSchedule({
      licenseCategory: resolveAutomationLicenseCategory(applicantRecord),
      examCenter: assignedSchedule.examCenter,
      examDate: assignedSchedule.examDate,
      examTime: assignedSchedule.examTime,
      location: applicantRecord.preferredLocation
    });
    const resolved = await attemptReserve({
      examScheduleId: liveAssigned.examScheduleId,
      examCenter: assignedSchedule.examCenter,
      examDate: assignedSchedule.examDate,
      examTime: assignedSchedule.examTime,
      locationName: liveAssigned.locationName,
      amount: liveAssigned.amount
    });
    if (resolved) {
      return resolved;
    }
  } catch (error) {
    lastError = error;
    logger.warn("Assigned slot live resolution failed", {
      applicantId: applicantRecord.id,
      message: error.message
    });
  }

  const searchPasses = [
    assignedSchedule,
    // Same site/location — only relax time if the exact preferred time is already booked.
    { ...assignedSchedule, examTime: null }
  ];

  for (const pass of searchPasses) {
    const candidates = await listBookableSchedulesForApplicant(applicantRecord, pass);
    for (const candidate of candidates.slice(0, maxAlternateAttempts)) {
      const booked = await attemptReserve(candidate);
      if (booked) {
        return booked;
      }
    }
  }

  throw lastError || new Error("All candidate schedules were rejected by Irembo.");
}

export async function runApplicantAutomation(applicantId) {
  if (await isApplicantHeldForBatch(applicantId)) {
    return { skipped: true, reason: "BATCH_SCHEDULED" };
  }

  const applicantRecord = await getApplicantById(applicantId, true);
  if (!applicantRecord) {
    throw new Error("Applicant not found");
  }

  const forceRun = consumeForceAutomationRun(applicantId);
  if (shouldDeferAutomation(applicantRecord, { force: forceRun })) {
    return { skipped: true, reason: "DEFERRED" };
  }

  return withApplicantAutomationLock(applicantId, async () => {
    if (isTestMode() && applicantRecord.status === "APPLICATION_CREATED") {
      logger.info("Test mode skip: applicant already processed", { applicantId });
      return { skipped: true, reason: "ALREADY_PROCESSED" };
    }

    let application = await getLatestApplicationForApplicant(applicantId);
    if (!application) {
      application = await createApplicationRecord(applicantId, { status: "PENDING" });
    }

    const nationalId = applicantRecord.nationalIdFull;
    if (!nationalId) {
      throw new Error("Unable to decrypt applicant national ID");
    }

    const assignedSchedule = resolveAssignedSchedule(applicantRecord);
    const failedScheduleIds = await getFailedScheduleIds(applicantId);
    const isExistingApplicant = isExistingLicenseApplicant(applicantRecord);
    let license = null;

    try {
      let entityId = applicantRecord.entityId;

      await setApplicantStatus(applicantId, "LICENSE_VALIDATED", null);
      if (isExistingApplicant) {
        license = await resolveLicenseForApplication(applicantRecord, nationalId);
      } else if (applicantRecord.provisionalLicenseNumber) {
        license = {
          licenseNumber: applicantRecord.provisionalLicenseNumber,
          dateOfExpiry: applicantRecord.provisionalLicenseExpiry
        };
      } else {
        license = await resolveLicenseForApplication(applicantRecord, nationalId);
      }

      if (!entityId) {
        await setApplicantStatus(applicantId, "PENDING", "Fetching citizen profile from Irembo...");
        const profile = await lookupEntityIdFromIrembo({
          nationalId,
          fullName: applicantRecord.fullName,
          existingLicense: isExistingApplicant
            ? {
                licenseNumber: applicantRecord.existingLicenseNumber,
                firstName: applicantRecord.fullName?.split(/\s+/).slice(-1)[0] || "",
                lastName: applicantRecord.fullName?.split(/\s+/)[0] || ""
              }
            : null
        });
        entityId = profile.entityId;
        await setApplicantEntityId(applicantId, entityId);
      }

      logger.info("Using verified citizen entityId", { applicantId, entityId });

      await updateApplicationRecord(application.id, {
        iremboEntityId: entityId,
        status: "PROFILE_FETCHED"
      });

      if (isExistingApplicant) {
        logger.info("Skipping provisional licence validation for add-category workflow", { applicantId });
      } else if (!applicantRecord.provisionalLicenseNumber) {
        await validateDefinitiveLicense(nationalId);
      } else {
        logger.info("Skipping definitive validation; using stored provisional licence", { applicantId });
      }

      await setApplicantStatus(applicantId, "RESERVING_SLOT", null);
      const booking = await reserveFirstAvailableSchedule(
        applicantRecord,
        assignedSchedule,
        failedScheduleIds
      );

      if (
        booking.examCenter !== assignedSchedule.examCenter ||
        booking.examTime !== assignedSchedule.examTime ||
        (booking.locationName && booking.locationName !== applicantRecord.preferredLocation)
      ) {
        await assignScheduleToApplicant(applicantId, {
          examScheduleId: booking.examScheduleId,
          examCenter: booking.examCenter,
          examDate: booking.examDate,
          examTime: booking.examTime,
          preferredLocation: booking.locationName || applicantRecord.preferredLocation,
          assignedScheduleId: applicantRecord.assignedScheduleId
        });
        if (booking.locationName) {
          applicantRecord.preferredLocation = booking.locationName;
        }
      }

      await logAutomationEvent({
        applicantId,
        action: "RESERVE_TEMPORARY_SLOT",
        requestPayload: { examScheduleId: booking.examScheduleId },
        responsePayload: { temporaryBookingId: booking.temporaryBookingId },
        success: true
      });
      await updateApplicationRecord(application.id, {
        examScheduleId: booking.examScheduleId,
        temporaryBookingId: booking.temporaryBookingId,
        status: "SLOT_RESERVED"
      });
      await setApplicantStatus(applicantId, "SLOT_RESERVED", null);

      logger.info("Submitting Irembo application", {
        applicantId,
        examScheduleId: booking.examScheduleId,
        temporaryBookingId: booking.temporaryBookingId
      });

      const notificationPhone = normalizeRwandaPhone(applicantRecord.phone);

      const created = await createDrivingLicenseApplication({
        entityId,
        provisionalLicenseNumber: license.licenseNumber,
        examScheduleId: booking.examScheduleId,
        temporaryBookingId: booking.temporaryBookingId,
        licenseCategory: resolveAutomationLicenseCategory(applicantRecord),
        examCenter: booking.examCenter,
        examType: applicantRecord.examType,
        examScheduleDate: buildExamScheduleDate(booking.examDate, booking.examTime),
        preferredLocation: applicantRecord.preferredLocation,
        locationName: booking.locationName || applicantRecord.preferredLocation,
        amount: booking.amount,
        phone: applicantRecord.phone,
        email: applicantRecord.email,
        serviceCode: isExistingApplicant ? SUPPLEMENTARY_SERVICE_CODE : undefined
      });

      await logAutomationEvent({
        applicantId,
        action: "CREATE_APPLICATION",
        requestPayload: {
          entityId,
          examScheduleId: booking.examScheduleId,
          temporaryBookingId: booking.temporaryBookingId,
          notificationPhone,
          notificationEmail: applicantRecord.email
        },
        responsePayload: created,
        success: true
      });

      await updateApplicationRecord(application.id, {
        applicationNumber: created.applicationNumber,
        amount: created.amount,
        status: created.applicationState || "PAYMENT_PENDING",
        responseData: created.raw
      });

      const iremboMessage = String(created.raw?.message || "").trim();
      const completionNote = created.alreadyExists
        ? iremboMessage ||
          `Application ${created.applicationNumber} already exists on Irembo — no new SMS is sent. Check earlier messages or pay outstanding fees.`
        : `Application ${created.applicationNumber} submitted. Irembo SMS/email goes to ${notificationPhone} and ${applicantRecord.email} within a few minutes.`;

      await setApplicantStatus(applicantId, "APPLICATION_CREATED", completionNote);

      if (!created.alreadyExists) {
        await sendApplicationCreatedNotification({
          email: applicantRecord.email,
          phone: applicantRecord.phone,
          fullName: applicantRecord.fullName,
          applicationNumber: created.applicationNumber,
          status: created.applicationState || "PAYMENT_PENDING"
        });
      }

      logger.info("Application created", {
        applicantId,
        applicationNumber: created.applicationNumber
      });

      return {
        ok: true,
        applicantId,
        applicationNumber: created.applicationNumber,
        status: created.applicationState || "PAYMENT_PENDING"
      };
    } catch (error) {
      logger.error("Applicant automation failed", { applicantId, message: error.message });

      if (isRateLimitError(error)) {
        markApplicantRateLimited(applicantId);
        markProfileLookupRateLimited();
        const retryMessage = `Irembo is busy for ${applicantRecord.fullName}. Auto-retry scheduled — wait, no manual steps needed.`;
        await setApplicantStatus(applicantId, "PENDING", retryMessage);
        if (application?.id) {
          await updateApplicationRecord(application.id, {
            status: "PENDING",
            responseData: { error: retryMessage, retryable: true }
          });
        }
        await logAutomationEvent({
          applicantId,
          action: "PROFILE_RATE_LIMITED",
          requestPayload: { applicantId },
          responsePayload: { retryable: true },
          success: false,
          errorMessage: error.message
        });
        return { skipped: true, reason: "RATE_LIMIT", retryable: true };
      }

      if (isSlotUnavailableError(error)) {
        const failedScheduleId =
          applicantRecord.assignedScheduleId ||
          extractRawScheduleId(applicantRecord.matchedExamScheduleId);
        if (failedScheduleId) {
          await appendFailedScheduleId(applicantId, failedScheduleId);
        }
        await clearApplicantAssignment(applicantId, error.message);
        clearAutomationCooldown(applicantId);
        if (application?.id) {
          await updateApplicationRecord(application.id, {
            status: "WAITING_FOR_SLOT",
            responseData: { error: error.message }
          });
        }
        await logAutomationEvent({
          applicantId,
          action: "SLOT_UNAVAILABLE",
          requestPayload: { applicantId },
          responsePayload: { error: error.message, failedScheduleId },
          success: false,
          errorMessage: error.message
        });
        throw new Error(
          "Irembo rejected this slot (schedule error). The monitor shows availability but booking failed — trying the next slot shortly."
        );
      }

      const nextStatus = error.message.includes("Waiting for a matching detected schedule")
        ? "WAITING_FOR_SLOT"
        : classifyFailure(error);
      await setApplicantStatus(applicantId, nextStatus, error.message);
      if (application?.id) {
        await updateApplicationRecord(application.id, { status: "FAILED", responseData: { error: error.message } });
      }
      await logAutomationEvent({
        applicantId,
        action: "AUTOMATION_FAILED",
        requestPayload: { applicantId },
        responsePayload: null,
        success: false,
        errorMessage: error.message
      });
      throw error;
    }
  }, { force: forceRun });
}
