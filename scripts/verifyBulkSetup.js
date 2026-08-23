import { loadEnvFiles } from "../lib/loadEnv.js";
import { ensureDatabaseSchema } from "../lib/ensureSchema.js";
import { prisma } from "../lib/db.js";

loadEnvFiles();

await ensureDatabaseSchema();

const tables = await prisma.$queryRawUnsafe(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('AutomationBatch', 'Applicant')
  ORDER BY table_name;
`);

const batchColumns = await prisma.$queryRawUnsafe(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'Applicant'
    AND column_name = 'batchId';
`);

console.log("Tables:", tables);
console.log("Applicant.batchId column:", batchColumns);
console.log("Prisma automationBatch model:", typeof prisma.automationBatch?.create === "function" ? "OK" : "MISSING - run npx prisma generate");

await prisma.$disconnect();
