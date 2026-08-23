import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main.js", "utf8");
const i = s.indexOf("exchangeToken(V,E){");
console.log(s.slice(i, i + 600));
