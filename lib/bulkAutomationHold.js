import { prisma } from "./db.js";
import { ensureDatabaseSchema } from "./ensureSchema.js";

export async function isApplicantHeldForBatch(applicantId) {
  await ensureDatabaseSchema();
  const applicant = await prisma.applicant.findUnique({
    where: { id: Number(applicantId) },
    include: { batch: true }
  });
  if (!applicant?.batch) {
    return false;
  }
  if (applicant.batch.status === "DRAFT") {
    return true;
  }
  if (applicant.batch.status !== "SCHEDULED") {
    return false;
  }
  return new Date(applicant.batch.scheduledAt) > new Date();
}
