import axios from "axios";
import { loadEnvFiles } from "../lib/loadEnv.js";

loadEnvFiles();

const base = "https://irembo.gov.rw/irembo/rest/accounts";
const user = process.env.IREMBO_USERNAME || "";
const pass = process.env.IREMBO_PASSWORD || "";

console.log("username configured:", Boolean(user), user ? user.slice(0, 4) + "***" : "");

const auth = await axios.post(
  `${base}/authenticate`,
  { username: user || "0000000000000000", password: pass || "bad" },
  { validateStatus: () => true, timeout: 20000 }
);
console.log("\nauthenticate", auth.status);
console.log(JSON.stringify(auth.data, null, 2)?.slice(0, 1200));
console.log("cookies", auth.headers["set-cookie"]);

if (auth.data?.data?.sessionId || auth.data?.sessionId) {
  const sessionId = auth.data?.data?.sessionId || auth.data?.sessionId;
  const login = await axios.post(`${base}/login`, auth.data?.data || auth.data, {
    headers: {
      sessionId,
      invalidateCurrentActiveSession: "true"
    },
    validateStatus: () => true,
    timeout: 20000
  });
  console.log("\nlogin", login.status);
  console.log(JSON.stringify(login.data, null, 2)?.slice(0, 1200));
  console.log("cookies", login.headers["set-cookie"]);
}

// Also try public/authenticate under accounts
const pub = await axios.post(
  `${base}/public/authenticate`,
  { username: user || "0000000000000000", password: pass || "bad" },
  { validateStatus: () => true,
    timeout: 20000 }
);
console.log("\npublic/authenticate", pub.status, JSON.stringify(pub.data)?.slice(0, 400));
