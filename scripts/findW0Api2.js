import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
const patterns = ["W0=function", "W0=class", "var W0", "W0:(", "92340:", "13149:"];
for (const p of patterns) {
  const i = s.indexOf(p);
  if (i >= 0) console.log(p, s.slice(i, i + 300));
}

// brute: find "API:" near "accounts"
let pos = 0;
while ((pos = s.indexOf("accounts", pos + 1)) !== -1) {
  const chunk = s.slice(pos - 80, pos + 120);
  if (chunk.includes("API") || chunk.includes("/rest")) {
    console.log("---", chunk);
    break;
  }
}
