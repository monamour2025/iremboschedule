export const SUCCESS_APPLICATION_STATUSES = new Set([
  "APPLICATION_CREATED",
  "COMPLETED",
  "PAYMENT_PENDING"
]);

export const NEW_APPLICANT_DAYS = 7;
export const RECENT_APPLICANT_LIMIT = 30;

function isFailedStatus(status) {
  return String(status || "").startsWith("FAILED") || status === "FAILED";
}

function formatExamSlot(applicant) {
  const date = applicant.examDate || "";
  const time = applicant.examTime || "";
  if (date && time) {
    return `${date} ${time}`;
  }
  if (applicant.assignedExam?.label) {
    return applicant.assignedExam.label;
  }
  return "-";
}

function countByCategory(applicants) {
  const counts = {};
  for (const row of applicants) {
    const key = row.licenseCategory || "Unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function isNewApplicant(createdAt, now = Date.now()) {
  const cutoff = now - NEW_APPLICANT_DAYS * 24 * 60 * 60 * 1000;
  return new Date(createdAt).getTime() >= cutoff;
}

export function mapApplicantToReportRow(row, now = Date.now()) {
  const application = row.applications?.[0] || {};
  return {
    id: row.id,
    fullName: row.fullName,
    phone: row.phone,
    email: row.email,
    licenseCategory: row.licenseCategory,
    preferredLocation: row.preferredLocation || "-",
    examCenter: row.examCenter || "-",
    examSlot: formatExamSlot(row),
    applicationNumber: row.applicationNumber || null,
    paymentCode: row.applicationNumber || "-",
    status: row.status,
    amount: application.amount ?? null,
    batchName: row.batchName || "-",
    provisionalLicenseNumber: row.provisionalLicenseNumber || "-",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    isNew: isNewApplicant(row.createdAt, now),
    hasSuccess: SUCCESS_APPLICATION_STATUSES.has(row.status) && Boolean(row.applicationNumber)
  };
}

export async function buildAutomationReport(listApplicants) {
  const now = Date.now();
  const applicants = await listApplicants();
  const allRows = applicants.map((row) => mapApplicantToReportRow(row, now));

  const successfulApplicants = allRows.filter((row) => row.hasSuccess);
  const failedApplicants = applicants.filter((row) => isFailedStatus(row.status));
  const inProgressApplicants = applicants.filter(
    (row) => !SUCCESS_APPLICATION_STATUSES.has(row.status) && !isFailedStatus(row.status)
  );

  const newApplicants = allRows
    .filter((row) => row.isNew)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const recentApplicants = [...allRows]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, RECENT_APPLICANT_LIMIT);

  return {
    generatedAt: new Date().toISOString(),
    windows: {
      newApplicantDays: NEW_APPLICANT_DAYS,
      recentApplicantLimit: RECENT_APPLICANT_LIMIT
    },
    summary: {
      totalApplicants: applicants.length,
      successfulApplications: successfulApplicants.length,
      newApplicants: newApplicants.length,
      recentApplicants: recentApplicants.length,
      paymentPending: successfulApplicants.filter((row) => row.status === "PAYMENT_PENDING").length,
      completed: successfulApplicants.filter((row) => row.status === "COMPLETED").length,
      failed: failedApplicants.length,
      inProgress: inProgressApplicants.length,
      byCategory: countByCategory(successfulApplicants)
    },
    successfulApplicants,
    newApplicants,
    recentApplicants
  };
}
