import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const terms = ["public/exchange", "exchangeToken", "setAuthorization", "Authorization"];
for (const term of terms) {
  const i = s.indexOf(term);
  if (i >= 0) console.log("\n===", term, "===\n", s.slice(i - 100, i + 500));
}
