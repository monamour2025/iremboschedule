import { prisma, assertAutomationModels } from "../lib/db.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { serializeApplication } from "./applicantService.js";
import { fetchPaymentTransactionByApplicationNumber } from "../providers/iremboApplicationProvider.js";
import { logger } from "../lib/logger.js";

export async function createApplicationRecord(applicantId, data = {}) {
  const application = await prisma.application.create({
    data: {
      applicantId: Number(applicantId),
      iremboEntityId: data.iremboEntityId || null,
      temporaryBookingId: data.temporaryBookingId || null,
      examScheduleId: data.examScheduleId || null,
      applicationNumber: data.applicationNumber || null,
      amount: data.amount ?? null,
      status: data.status || "PENDING",
      responseData: data.responseData ? JSON.stringify(data.responseData) : null
    }
  });

  return serializeApplication(application);
}

export async function updateApplicationRecord(id, data = {}) {
  const application = await prisma.application.update({
    where: { id: Number(id) },
    data: {
      ...(data.iremboEntityId !== undefined ? { iremboEntityId: data.iremboEntityId } : {}),
      ...(data.temporaryBookingId !== undefined ? { temporaryBookingId: data.temporaryBookingId } : {}),
      ...(data.examScheduleId !== undefined ? { examScheduleId: data.examScheduleId } : {}),
      ...(data.applicationNumber !== undefined ? { applicationNumber: data.applicationNumber } : {}),
      ...(data.amount !== undefined ? { amount: data.amount } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.responseData !== undefined
        ? { responseData: JSON.stringify(data.responseData) }
        : {})
    }
  });

  return serializeApplication(application);
}

function parseResponseData(value) {
  if (!value) {
    return {};
  }
  if (typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value) || {};
  } catch {
    return {};
  }
}

function applicantStatusForPayment(paymentStatus, currentApplicantStatus) {
  if (paymentStatus === "PAYMENT_EXPIRED") {
    return "PAYMENT_EXPIRED";
  }
  if (paymentStatus === "PAID") {
    return "COMPLETED";
  }
  if (paymentStatus === "PAYMENT_CANCELLED") {
    return "PAYMENT_CANCELLED";
  }
  if (paymentStatus === "PAYMENT_PENDING") {
    if (["APPLICATION_CREATED", "PAYMENT_PENDING"].includes(currentApplicantStatus)) {
      return currentApplicantStatus;
    }
    return "APPLICATION_CREATED";
  }
  return currentApplicantStatus;
}

async function syncApplicationFromIrembo(application, applicant) {
  const applicationNumber = String(application.applicationNumber || "").trim();
  if (!applicationNumber) {
    return {
      ...serializeApplication({ ...application, applicant }),
      applicantName: applicant?.fullName || "-",
      iremboSynced: false,
      paymentExpiresAt: null
    };
  }

  try {
    const live = await fetchPaymentTransactionByApplicationNumber(applicationNumber);
    const nextStatus = live.paymentStatus || application.status;
    const existingResponse = parseResponseData(application.responseData);
    const nextResponse = {
      ...existingResponse,
      iremboPayment: {
        paymentStatus: live.iremboPaymentStatus,
        mappedStatus: live.paymentStatus,
        billRefNumber: live.billRefNumber,
        paymentExpirationTime: live.paymentExpirationTime,
        creationTime: live.creationTime,
        serviceCode: live.serviceCode,
        syncedAt: new Date().toISOString()
      }
    };

    const amount = live.amount != null ? live.amount : application.amount;
    const statusChanged = Boolean(nextStatus && nextStatus !== application.status);
    const amountChanged = amount != null && amount !== application.amount;

    await prisma.application.update({
      where: { id: application.id },
      data: {
        ...(statusChanged ? { status: nextStatus } : {}),
        ...(amountChanged ? { amount } : {}),
        responseData: JSON.stringify(nextResponse)
      }
    });
    if (statusChanged) {
      application.status = nextStatus;
    }
    if (amountChanged) {
      application.amount = amount;
    }
    application.responseData = JSON.stringify(nextResponse);

    if (applicant?.id && live.paymentStatus) {
      const nextApplicantStatus = applicantStatusForPayment(live.paymentStatus, applicant.status);
      if (nextApplicantStatus && nextApplicantStatus !== applicant.status) {
        const lastError =
          live.paymentStatus === "PAYMENT_EXPIRED"
            ? `Irembo application ${applicationNumber} payment expired${
                live.paymentExpirationTime ? ` on ${live.paymentExpirationTime}` : ""
              }. Create a new application.`
            : null;
        await prisma.applicant.update({
          where: { id: applicant.id },
          data: {
            status: nextApplicantStatus,
            lastError
          }
        });
        applicant.status = nextApplicantStatus;
        applicant.lastError = lastError;
      }
    }

    return {
      ...serializeApplication({ ...application, applicant }),
      applicantName: applicant?.fullName || "-",
      iremboSynced: true,
      iremboPaymentStatus: live.iremboPaymentStatus,
      paymentExpiresAt: live.paymentExpirationTime || null
    };
  } catch (error) {
    logger.warn("Failed to sync application status from Irembo", {
      applicationNumber,
      message: error.message
    });
    return {
      ...serializeApplication({ ...application, applicant }),
      applicantName: applicant?.fullName || "-",
      iremboSynced: false,
      syncError: error.message,
      paymentExpiresAt:
        parseResponseData(application.responseData)?.iremboPayment?.paymentExpirationTime || null
    };
  }
}

export async function listApplications({ syncFromIrembo = true } = {}) {
  await ensureDatabaseSchema();
  assertAutomationModels();

  const applications = await prisma.application.findMany({
    orderBy: { createdAt: "desc" }
  });

  if (applications.length === 0) {
    return [];
  }

  const applicantIds = [...new Set(applications.map((row) => row.applicantId))];
  const applicants = await prisma.applicant.findMany({
    where: { id: { in: applicantIds } }
  });
  const applicantById = new Map(applicants.map((row) => [row.id, row]));

  const orphanedIds = applications
    .filter((row) => !applicantById.has(row.applicantId))
    .map((row) => row.id);

  if (orphanedIds.length > 0) {
    await prisma.application.deleteMany({ where: { id: { in: orphanedIds } } });
  }

  const liveRows = applications.filter((row) => applicantById.has(row.applicantId));

  if (!syncFromIrembo) {
    return liveRows.map((application) => {
      const applicant = applicantById.get(application.applicantId);
      return {
        ...serializeApplication({ ...application, applicant }),
        applicantName: applicant.fullName,
        iremboSynced: false,
        paymentExpiresAt:
          parseResponseData(application.responseData)?.iremboPayment?.paymentExpirationTime || null
      };
    });
  }

  const synced = [];
  for (const application of liveRows) {
    const applicant = applicantById.get(application.applicantId);
    synced.push(await syncApplicationFromIrembo(application, applicant));
  }
  return synced;
}

export async function getLatestApplicationForApplicant(applicantId) {
  return prisma.application.findFirst({
    where: { applicantId: Number(applicantId) },
    orderBy: { createdAt: "desc" }
  });
}

/** True when local/Irembo status means the code is no longer a valid unpaid application. */
export function isExpiredOrClosedApplicationStatus(status) {
  const normalized = String(status || "").trim().toUpperCase();
  return ["PAYMENT_EXPIRED", "PAYMENT_CANCELLED", "EXPIRED", "FAILED", "CANCELLED"].includes(
    normalized
  );
}

/**
 * Whether this applicant still has a live unpaid Irembo code.
 * Expired codes must not block creating a new application.
 */
export function hasActiveUnpaidApplication(applicant) {
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

/**
 * Sync PAYMENT_PENDING / APPLICATION_CREATED codes against Irembo.
 * Used by applicants list so expired codes stop blocking re-apply.
 */
export async function syncApplicantPaymentStatusesFromIrembo(applicants = []) {
  const targets = applicants.filter((applicant) => {
    const status = String(applicant.status || "").toUpperCase();
    const appStatus = String(applicant.applications?.[0]?.status || "").toUpperCase();
    const number = applicant.applications?.[0]?.applicationNumber;
    if (!number) {
      return false;
    }
    return (
      ["APPLICATION_CREATED", "PAYMENT_PENDING", "COMPLETED"].includes(status) ||
      ["PAYMENT_PENDING", "PENDING"].includes(appStatus)
    );
  });

  for (const applicant of targets) {
    const application = applicant.applications?.[0];
    if (!application) {
      continue;
    }
    await syncApplicationFromIrembo(application, applicant);
  }
}
