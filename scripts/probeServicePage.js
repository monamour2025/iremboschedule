import axios from "axios";

const url =
  "https://irembo.gov.rw/home/citizen/service/REGISTRATION_FOR_DRIVING_LICENSE_TEST_DEFINITIVE";
const r = await axios.get(url, {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "text/html"
  },
  validateStatus: () => true,
  timeout: 30000
});

const html = String(r.data);
console.log("status", r.status, "len", html.length);
console.log("set-cookie", r.headers["set-cookie"]);

for (const term of ["token", "csrf", "session", "entityId", "apiKey", "clientId", "recaptcha"]) {
  const re = new RegExp(term, "gi");
  const matches = html.match(re);
  if (matches?.length) console.log(term, matches.length);
}

const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
console.log("scripts", scripts.slice(0, 5));

// look for inline config
const configMatch = html.match(/window\.__[^=]+=\{[^<]{0,500}/);
console.log("inline config", configMatch?.[0]?.slice(0, 300));
