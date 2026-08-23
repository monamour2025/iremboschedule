export function assertCronAccess(request) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    const error = new Error("CRON_SECRET is not configured on this deployment.");
    error.statusCode = 503;
    throw error;
  }

  const authorization = request.headers.get("authorization") || "";
  if (authorization !== `Bearer ${cronSecret}`) {
    const error = new Error("Unauthorized cron request.");
    error.statusCode = 401;
    throw error;
  }

  return true;
}
