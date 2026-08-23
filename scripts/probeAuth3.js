import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
for (const term of ["92340", "W0=", "NZ=", "API+"]) {
  let idx = 0;
  let count = 0;
  while ((idx = s.indexOf(term, idx + 1)) !== -1 && count < 3) {
    console.log("---", term, count++, s.slice(idx, idx + 250));
  }
}
