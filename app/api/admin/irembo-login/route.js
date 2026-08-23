import { assertAdminAccess } from "../../../../lib/automationConfig.js";
import {
  getIremboCredentialsStatus,
  setRuntimeIremboCredentials
} from "../../../../lib/iremboCitizenAuth.js";
import { ensureIremboCitizenAuth } from "../../../../lib/iremboCitizenAuth.js";
import { bootstrapProfileSession } from "../../../../lib/iremboProfileSession.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    assertAdminAccess(request);
    return Response.json({ ok: true, credentials: getIremboCredentialsStatus() });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 500 });
  }
}

export async function POST(request) {
  try {
    assertAdminAccess(request);
    const body = await request.json();
    const username = String(body.username || "").trim();
    const password = String(body.password || "").trim();
    if (!username || !password) {
      return Response.json({ ok: false, error: "Enter your Irembo national ID and password." }, { status: 400 });
    }
    setRuntimeIremboCredentials(username, password);
    await bootstrapProfileSession(true);
    await ensureIremboCitizenAuth(true);
    return Response.json({ ok: true, credentials: getIremboCredentialsStatus() });
  } catch (error) {
    return Response.json({ ok: false, error: error.message }, { status: error.statusCode || 502 });
  }
}
