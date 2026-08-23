import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const i = s.indexOf("authServiceUrl");
console.log(s.slice(i - 200, i + 600));
