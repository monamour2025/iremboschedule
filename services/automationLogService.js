import { prisma } from "../lib/db.js";

export async function logAutomationEvent({
  applicantId,
  action,
  requestPayload,
  responsePayload,
  success,
  errorMessage
}) {
  return prisma.automationLog.create({
    data: {
      applicantId: Number(applicantId),
      action,
      requestPayload: requestPayload ? JSON.stringify(requestPayload) : null,
      responsePayload: responsePayload ? JSON.stringify(responsePayload) : null,
      success: Boolean(success),
      errorMessage: errorMessage || null
    }
  });
}

export async function listAutomationLogs(applicantId) {
  return prisma.automationLog.findMany({
    where: { applicantId: Number(applicantId) },
    orderBy: { createdAt: "desc" }
  });
}
