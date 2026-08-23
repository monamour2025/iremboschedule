import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const terms = [
  "accounts/authenticate",
  "accounts/login",
  "public/authenticate",
  "invalidateCurrentActiveSession",
  "otpValue",
  "sessionId",
  "getPrivateRecord",
  "isAuthenticated"
];
for (const term of terms) {
  const i = s.indexOf(term);
  if (i >= 0) console.log("\n===", term, "===\n", s.slice(i - 100, i + 400));
}
