import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main.js", "utf8");
const apis = [...s.matchAll(/API:"([^"]+)"/g)].map((m) => m[1]);
console.log([...new Set(apis)].filter((a) => a.includes("irembo") || a.startsWith("/")).slice(0, 20));

const w0 = s.match(/W0=\{[^}]{0,300}\}/);
console.log("W0", w0?.[0]);
