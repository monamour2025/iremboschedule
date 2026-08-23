import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main.js", "utf8");
const re = /exchangeToken\([^{]+\{[^}]{0,800}/g;
let m;
while ((m = re.exec(s))) {
  console.log(m[0]);
  console.log("---");
}
