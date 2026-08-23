let runtimeCookie = String(process.env.IREMBO_CITIZEN_COOKIE || "").trim();

export function getRuntimeIremboCookie() {
  return runtimeCookie || String(process.env.IREMBO_CITIZEN_COOKIE || "").trim();
}

export function setRuntimeIremboCookie(cookie) {
  runtimeCookie = String(cookie || "").trim();
}

export function hasIremboBrowserSession() {
  return Boolean(getRuntimeIremboCookie());
}

export function getIremboSessionStatus() {
  const cookie = getRuntimeIremboCookie();
  return {
    configured: Boolean(cookie),
    source: runtimeCookie ? "runtime" : cookie ? "env" : "none",
    preview: cookie ? `${cookie.slice(0, 24)}…` : null
  };
}
