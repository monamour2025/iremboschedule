import axios from "axios";

// Keycloak token endpoint
const tokenUrl = "https://id.irembohub.com/realms/irembo/protocol/openid-connect/token";

const user = process.env.IREMBO_USERNAME || "";
const pass = process.env.IREMBO_PASSWORD || "";

if (!user || !pass) {
  console.log("Set IREMBO_USERNAME and IREMBO_PASSWORD env vars to test login");
  process.exit(0);
}

const token = await axios.post(
  tokenUrl,
  new URLSearchParams({
    grant_type: "password",
    client_id: "irembo-gov-2_0-portal",
    username: user,
    password: pass
  }),
  { validateStatus: () => true, timeout: 30000 }
);
console.log("keycloak", token.status, JSON.stringify(token.data)?.slice(0, 400));

if (token.data?.access_token) {
  for (const exchangeUrl of [
    "https://irembo.gov.rw/irembo/public/exchange",
    "https://irembo.gov.rw/irembo/rest/public/exchange",
    "https://irembo.gov.rw/irembo/rest/accounts/public/exchange"
  ]) {
    const ex = await axios.post(
      exchangeUrl,
      { token: token.data.access_token },
      { validateStatus: () => true, timeout: 30000 }
    );
    console.log("\nexchange", exchangeUrl, ex.status, JSON.stringify(ex.data)?.slice(0, 300));
    console.log("cookies", ex.headers["set-cookie"]?.length || 0);
  }
}
