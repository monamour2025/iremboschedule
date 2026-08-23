import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const idx = s.indexOf("W0.API");
console.log(s.slice(idx - 500, idx + 200));

// search for accounts in bundle with rest path
const hits = [...s.matchAll(/\/rest\/accounts[^"'\\s]*/g)].map((m) => m[0]);
console.log("\naccounts paths:", [...new Set(hits)].slice(0, 15));
