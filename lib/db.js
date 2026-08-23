import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis;

function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"]
  });
}

function getPrismaClient() {
  const cached = globalForPrisma.prisma;
  if (cached?.applicant && cached?.application && cached?.automationLog && cached?.automationBatch) {
    return cached;
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}

export const prisma = getPrismaClient();

export function assertAutomationModels() {
  if (!prisma.applicant || !prisma.application || !prisma.automationLog || !prisma.automationBatch) {
    const error = new Error(
      "Automation database models are unavailable. Stop the dev server, run `npx prisma generate`, then restart."
    );
    error.statusCode = 503;
    throw error;
  }
}
