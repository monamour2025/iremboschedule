import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const matches = s.match(/\/irembo\/rest[^"'\\s]{0,80}/g) || [];
const unique = [...new Set(matches)].filter((m) => m.includes("auth") || m.includes("login"));
console.log(unique.join("\n"));

const idx = s.indexOf("public/authenticate");
console.log("\ncontext:", s.slice(idx - 200, idx + 200));
