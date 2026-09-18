const ORIGIN = "iremboschedule-seven.vercel.app";

const NO_CACHE_PREFIXES = [
  "/api/cron",
  "/api/scan",
  "/api/automation",
  "/api/admin/irembo-login",
  "/api/admin/irembo-session",
  "/api/entity-id",
  "/api/applicants/fetch-existing-license",
  "/api/applicants/search-hold"
];

function cacheTtlSeconds(pathname) {
  if (NO_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return 0;
  }
  if (
    pathname.includes("/automate") ||
    pathname.includes("/cancel") ||
    pathname.includes("/resolve-profile") ||
    pathname.includes("/fetch-existing-license") ||
    pathname.includes("/lookup")
  ) {
    return 0;
  }
  if (pathname.startsWith("/_next/static/")) {
    return 86400;
  }
  if (pathname.startsWith("/api/")) {
    return 60;
  }
  return 120;
}

function cacheKey(request) {
  const url = new URL(request.url);
  return new Request(`https://cache.irembo-schedule-proxy${url.pathname}${url.search}`, {
    method: "GET"
  });
}

async function proxyToVercel(request) {
  const incoming = new URL(request.url);
  const target = new URL(`https://${ORIGIN}${incoming.pathname}${incoming.search}`);

  const headers = new Headers(request.headers);
  headers.set("Host", ORIGIN);
  headers.set("X-Forwarded-Host", incoming.host);
  headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""));

  const init = {
    method: request.method,
    headers,
    redirect: "manual"
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
  }

  const response = await fetch(target.toString(), init);
  const outHeaders = new Headers(response.headers);

  const location = outHeaders.get("Location");
  if (location?.includes(ORIGIN)) {
    outHeaders.set("Location", location.replace(`https://${ORIGIN}`, incoming.origin));
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outHeaders
  });
}

export default {
  async fetch(request, _env, ctx) {
    const incoming = new URL(request.url);
    const ttl = request.method === "GET" || request.method === "HEAD" ? cacheTtlSeconds(incoming.pathname) : 0;

    if (ttl > 0) {
      const key = cacheKey(request);
      const cached = await caches.default.match(key);
      if (cached) {
        const hitHeaders = new Headers(cached.headers);
        hitHeaders.set("X-Proxy-Cache", "HIT");
        return new Response(cached.body, {
          status: cached.status,
          statusText: cached.statusText,
          headers: hitHeaders
        });
      }
    }

    const originResponse = await proxyToVercel(request);
    if (ttl <= 0 || originResponse.status !== 200 || originResponse.headers.has("Set-Cookie")) {
      const headers = new Headers(originResponse.headers);
      headers.set("X-Proxy-Cache", "BYPASS");
      return new Response(originResponse.body, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers
      });
    }

    const storeHeaders = new Headers(originResponse.headers);
    storeHeaders.set("Cache-Control", `public, max-age=${ttl}`);
    storeHeaders.set("X-Proxy-Cache", "MISS");
    const cachedResponse = new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: storeHeaders
    });
    ctx.waitUntil(caches.default.put(cacheKey(request), cachedResponse.clone()));
    return cachedResponse;
  }
};
