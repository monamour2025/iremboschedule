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

function decodeKeycloakExpiry(cookie) {
  const match =
    cookie.match(/(?:^|;\s*)KEYCLOAK_IDENTITY=([^;]+)/) ||
    cookie.match(/(?:^|;\s*)KEYCLOAK_IDENTITY_LEGACY=([^;]+)/);
  if (!match?.[1]) {
    return null;
  }
  try {
    const payloadPart = match[1].split(".")[1];
    if (!payloadPart) {
      return null;
    }
    const json = Buffer.from(payloadPart.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json);
    if (!payload?.exp) {
      return null;
    }
    return new Date(Number(payload.exp) * 1000);
  } catch {
    return null;
  }
}

export function getIremboCookieHealth() {
  const cookie = getRuntimeIremboCookie();
  if (!cookie) {
    return { present: false, expired: true, expiresAt: null };
  }
  const expiresAt = decodeKeycloakExpiry(cookie);
  if (!expiresAt) {
    return { present: true, expired: false, expiresAt: null };
  }
  return {
    present: true,
    expired: expiresAt.getTime() <= Date.now() + 60 * 1000,
    expiresAt: expiresAt.toISOString()
  };
}

export function getIremboSessionStatus() {
  const cookie = getRuntimeIremboCookie();
  const health = getIremboCookieHealth();
  return {
    configured: Boolean(cookie),
    source: runtimeCookie ? "runtime" : cookie ? "env" : "none",
    preview: cookie ? `${cookie.slice(0, 24)}…` : null,
    expired: health.expired,
    expiresAt: health.expiresAt
  };
}
