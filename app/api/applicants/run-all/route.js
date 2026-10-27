import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { prisma } from "../../../../lib/db.js";
import { ensureDatabaseSchema } from "../../../../lib/ensureSchema.js";
import { enqueueApplicantAutomation } from "../../../../lib/automationQueue.js";
import { flushInMemoryAutomationQueue } from "../../../../lib/automationQueue.js";
import { logger } from "../../../../lib/logger.js";

export const dynamic = "force-dynamic";

/**
 * POST /api/applicants/run-all
 *
 * Manually triggers automation for WAITING_FOR_SLOT applicants (or specific applicantIds),
 * grouped by their own licenseCategory. Each applicant is only ever booked into their own
 * requested category — no cross-category booking can happen.
 *
 * Request body options:
 * - { applicantIds: [123] } or { applicantId: 123 } to target specific person(s)
 * - { categories: ["A", "B"] } to limit which categories to trigger
 * - {} to trigger all waiting applicants
 */
export async function POST(request) {
  try {
    assertAdminAccess(request);
    await ensureDatabaseSchema();

    let body = {};
    try {
      body = await request.json();
    } catch {
      // body is optional
    }

    const filterCategories =
      Array.isArray(body.categories) && body.categories.length > 0
        ? body.categories.map((c) => String(c).trim().toUpperCase()).filter(Boolean)
        : null;

    const filterApplicantIds =
      Array.isArray(body.applicantIds) && body.applicantIds.length > 0
        ? body.applicantIds.map(Number).filter(Number.isInteger)
        : body.applicantId
          ? [Number(body.applicantId)].filter(Number.isInteger)
          : null;

    if (filterApplicantIds && filterApplicantIds.length > 0) {
      // If targeting specific person(s), reset paused or failed status so automation runs freshly
      await prisma.applicant.updateMany({
        where: {
          id: { in: filterApplicantIds },
          status: { notIn: ["APPLICATION_CREATED", "COMPLETED", "PAID"] }
        },
        data: { searchPaused: false, status: "WAITING_FOR_SLOT" }
      });
    }

    const where = filterApplicantIds
      ? {
          id: { in: filterApplicantIds },
          status: { notIn: ["APPLICATION_CREATED", "COMPLETED", "PAID"] }
        }
      : {
          status: "WAITING_FOR_SLOT",
          searchPaused: false
        };

    // Find target applicants
    const waiting = await prisma.applicant.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        licenseCategory: true,
        requestedLicenseCategory: true,
        status: true
      },
      orderBy: { createdAt: "asc" }
    });

    if (waiting.length === 0) {
      return Response.json({
        ok: true,
        triggered: 0,
        skipped: 0,
        byCategory: {},
        message: filterApplicantIds
          ? "Applicant not found or already completed."
          : "No applicants are currently waiting for a slot."
      });
    }

    // Group by their own requested/license category
    const grouped = {};
    for (const applicant of waiting) {
      const category = String(
        applicant.requestedLicenseCategory || applicant.licenseCategory || ""
      )
        .trim()
        .toUpperCase();

      if (!category) {
        continue;
      }

      // If caller restricted to specific categories, skip others
      if (filterCategories && !filterCategories.includes(category)) {
        continue;
      }

      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(applicant);
    }

    const byCategory = {};
    let triggered = 0;
    let skipped = 0;

    for (const [category, applicants] of Object.entries(grouped)) {
      byCategory[category] = { triggered: 0, skipped: 0, applicants: [] };

      for (const applicant of applicants) {
        try {
          const result = await enqueueApplicantAutomation(applicant.id, { force: true });
          if (result.queued) {
            triggered++;
            byCategory[category].triggered++;
            byCategory[category].applicants.push({
              id: applicant.id,
              name: applicant.fullName,
              queued: true
            });
          } else {
            skipped++;
            byCategory[category].skipped++;
            byCategory[category].applicants.push({
              id: applicant.id,
              name: applicant.fullName,
              queued: false,
              reason: result.reason
            });
          }
        } catch (enqueueError) {
          skipped++;
          byCategory[category].skipped++;
          logger.warn("run-all: failed to enqueue applicant", {
            applicantId: applicant.id,
            message: enqueueError.message
          });
        }
      }
    }

    logger.info("run-all: Create Application triggered", {
      triggered,
      skipped,
      categories: Object.keys(byCategory),
      filterApplicantIds
    });

    // On Vercel flush the queue so jobs run within this request lifecycle
    if (process.env.VERCEL) {
      try {
        const { after } = await import("next/server");
        after(() => flushInMemoryAutomationQueue());
      } catch {
        // after() not available in all Next.js versions; queue runs async
      }
    }

    const total = triggered + skipped;
    const message =
      triggered === 0
        ? `No applicants could be queued (${skipped} skipped — already running or on cooldown).`
        : `Triggering application for ${triggered} applicant${triggered !== 1 ? "s" : ""} across ${Object.keys(byCategory).length} categor${Object.keys(byCategory).length !== 1 ? "ies" : "y"}. Each person is only booked into their own category.`;

    return Response.json({
      ok: true,
      triggered,
      skipped,
      byCategory,
      message
    });
  } catch (error) {
    logger.error("run-all failed", { message: error.message });
    return Response.json(
      { ok: false, error: error.message },
      { status: error.statusCode || 500 }
    );
  }
}
