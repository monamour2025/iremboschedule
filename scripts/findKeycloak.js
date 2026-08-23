import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
for (const term of ["keycloak", "realm", "clientId", "tokenEndpoint", "grant_type"]) {
  let idx = 0;
  let n = 0;
  while ((idx = s.indexOf(term, idx + 1)) !== -1 && n < 2) {
    const chunk = s.slice(idx - 60, idx + 200);
    if (chunk.includes("irembo") || chunk.includes("http") || term === "keycloak") {
      console.log("\n===", term, n++, "===");
      console.log(chunk);
    }
  }
}
