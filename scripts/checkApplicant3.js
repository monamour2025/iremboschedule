import { loadEnvFiles } from "../lib/loadEnv.js";
import { listApplicants } from "../services/applicantService.js";
import { prisma } from "../lib/db.js";

loadEnvFiles();

const applicants = await listApplicants();
const applicant = applicants.find((row) => row.id === 3);
console.log(
  JSON.stringify(
    {
      id: applicant?.id,
      status: applicant?.status,
      applicationNumber: applicant?.applicationNumber,
      statusHint: applicant?.statusHint,
      lastError: applicant?.lastError
    },
    null,
    2
  )
);

await prisma.$disconnect();
