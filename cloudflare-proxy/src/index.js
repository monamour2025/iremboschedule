const ORIGIN = "iremboschedule-seven.vercel.app";

export default {
  async fetch(request) {
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
};
