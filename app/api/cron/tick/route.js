import { assertCronAccess } from "../../../../lib/cronAuth.js";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request) {
  assertCronAccess(request);
  return Response.json({
    ok: true,
    skipped: true,
    skipReason: "cpu_cap",
    message: "Automatic scan is off so Hobby Fluid CPU does not pause the site."
  });
}
