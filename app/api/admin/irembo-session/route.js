import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import {
  getIremboSessionStatus,
  setRuntimeIremboCookie
} from "../../../../lib/iremboBrowserSession.js";
import { bootstrapProfileSession } from "../../../../lib/iremboProfileSession.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    return Response.json({ ok: true, session: getIremboSessionStatus() });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const cookie = String(body.cookie || "").trim();
    if (!cookie) {
      return Response.json({ ok: false, error: "Paste the Cookie header from irembo.gov.rw." }, { status: 400 });
    }
    setRuntimeIremboCookie(cookie);
    await bootstrapProfileSession(true);
    return Response.json({ ok: true, session: getIremboSessionStatus() });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}
