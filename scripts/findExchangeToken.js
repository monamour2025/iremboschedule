import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const i = s.indexOf("exchangeToken(");
console.log(s.slice(i, i + 900));
