import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import { prisma } from "../../../../lib/db.js";
import { logger } from "../../../../lib/logger.js";
import { appendFailedScheduleId } from "../../../../lib/failedSchedules.js";
import {
  clearApplicantAssignment,
  deleteApplicant,
  getApplicantById,
  resetApplicantForRetry,
  setApplicantStatus,
  updateApplicant,
  updateBulkDraftApplicant
} from "../../../../services/applicantService.js";
import { assignScheduleFromMonitor, tryMatchApplicantImmediately } from "../../../../services/applicantMatchingService.js";
import { enqueueApplicantAutomation } from "../../../../lib/automationQueue.js";
import { clearApplicantRateLimitCooldown, isProfileRateLimitError } from "../../../../lib/applicantAutomationLock.js";
import { getProfileLookupBlockedMs } from "../../../../services/entityIdService.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    assertAdminAccess(request);
    const applicant = await getApplicantById(params.id, true);
    if (!applicant) {
      return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }
    return Response.json({ ok: true, applicant });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const current = await getApplicantById(params.id, true);
    if (!current) {
      return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    if (current.batchStatus === "DRAFT" && current.status === "SAVED") {
      const applicant = await updateBulkDraftApplicant(params.id, body);
      return Response.json({ ok: true, applicant, queued: false });
    }

    const applicant = await updateApplicant(params.id, body);

    if (body.selectedScheduleId) {
      const schedule = await prisma.schedule.findUnique({
        where: { scheduleId: String(body.selectedScheduleId) }
      });
      if (!schedule) {
        return Response.json({ ok: false, error: "Selected exam slot was not found." }, { status: 400 });
      }
      const category = String(body.licenseCategory || applicant.licenseCategory || "").toUpperCase();
      if (String(schedule.category || "").toUpperCase() !== category) {
        return Response.json(
          { ok: false, error: "Selected slot does not match the chosen licence category." },
          { status: 400 }
        );
      }
      await assignScheduleFromMonitor(params.id, body.selectedScheduleId);
    }

    let queued = false;
    if (body.restartAutomation) {
      clearApplicantRateLimitCooldown(params.id);
      await setApplicantStatus(params.id, "PENDING", null);
      const queueResult = await enqueueApplicantAutomation(params.id, { force: true });
      queued = queueResult.queued !== false;
    }

    const refreshed = await getApplicantById(params.id, false);
    return Response.json({ ok: true, applicant: refreshed, queued });
  } catch (error) {
    logger.error("Applicant update failed", { message: error.message });
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    assertAdminAccess(request);
    await deleteApplicant(params.id);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function POST(request, { params }) {
  try {
    assertAdminAccess(request);
    const body = await request.json().catch(() => ({}));
      if (body.action === "retry") {
      const applicant = await getApplicantById(params.id, false);
      const profileBlockedMs = getProfileLookupBlockedMs();
      const profileFailure =
        applicant?.status === "FAILED_LOOKUP" ||
        isProfileRateLimitError(applicant?.lastError) ||
        (!applicant?.entityId && profileBlockedMs > 0);

      if (profileFailure && !applicant?.entityId && profileBlockedMs > 0) {
        const minutes = Math.ceil(profileBlockedMs / 60_000);
        await setApplicantStatus(
          params.id,
          "PENDING",
          `Irembo is busy. Auto-retry in ~${minutes} min — no action needed.`
        );
        return Response.json({
          ok: true,
          queued: false,
          retryScheduled: true,
          message: `Profile link auto-retries in ~${minutes} min.`
        });
      }

      if (!profileFailure || applicant?.entityId) {
        clearApplicantRateLimitCooldown(params.id);
      }
      if (applicant?.status === "PENDING" && applicant.examCenter) {
        await setApplicantStatus(params.id, "PENDING", null);
        const queued = await enqueueApplicantAutomation(params.id, { force: true });
        return Response.json({ ok: true, queued: queued.queued !== false, reason: queued.reason || null });
      }
      if (applicant?.status === "WAITING_FOR_SLOT" && applicant.examCenter) {
        await setApplicantStatus(params.id, "PENDING", null);
        const queued = await enqueueApplicantAutomation(params.id, { force: true });
        return Response.json({ ok: true, queued: queued.queued !== false, reason: queued.reason || null });
      }
      const failedStatuses = ["FAILED", "FAILED_LOOKUP", "FAILED_VALIDATION", "FAILED_BOOKING", "FAILED_APPLICATION"];
      if (failedStatuses.includes(applicant?.status) && applicant.assignedScheduleId) {
        const errorMessage = String(applicant.lastError || "").toLowerCase();
        const slotFailure =
          applicant.status === "FAILED_BOOKING" ||
          ((errorMessage.includes("423") && !errorMessage.includes("profile")) ||
            errorMessage.includes("gahunda") ||
            errorMessage.includes("schedule error") ||
            errorMessage.includes("slot") ||
            errorMessage.includes("bookable"));
        if (slotFailure) {
          await appendFailedScheduleId(params.id, applicant.assignedScheduleId);
          await clearApplicantAssignment(params.id, null);
        } else {
          await setApplicantStatus(params.id, "PENDING", null);
          const queued = await enqueueApplicantAutomation(params.id, { force: true });
          return Response.json({ ok: true, queued: queued.queued !== false, reason: queued.reason || null });
        }
      } else if (failedStatuses.includes(applicant?.status)) {
        await setApplicantStatus(params.id, "PENDING", null);
        if (applicant.examCenter) {
          const queued = await enqueueApplicantAutomation(params.id, { force: true });
          return Response.json({ ok: true, queued: queued.queued !== false, reason: queued.reason || null });
        }
      } else {
        await resetApplicantForRetry(params.id);
      }
      const matches = await tryMatchApplicantImmediately(params.id);
      return Response.json({ ok: true, matches });
    }
    if (body.action === "setEntityId") {
      const entityId = String(body.entityId || "").trim();
      if (!entityId) {
        return Response.json({ ok: false, error: "ENTITY_ID_REQUIRED" }, { status: 400 });
      }
      const applicant = await updateApplicant(params.id, { entityId });
      clearApplicantRateLimitCooldown(params.id);
      if (applicant.examCenter) {
        await setApplicantStatus(params.id, "PENDING", null);
        const queued = await enqueueApplicantAutomation(params.id, { force: true });
        return Response.json({ ok: true, applicant, queued: queued.queued !== false });
      }
      return Response.json({ ok: true, applicant, queued: false });
    }
    return Response.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
