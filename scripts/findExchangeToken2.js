import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main-fresh.js", "utf8");
let idx = 0;
while ((idx = s.indexOf("exchangeToken", idx + 1)) !== -1) {
  const chunk = s.slice(idx, idx + 400);
  if (chunk.includes("post(") || chunk.includes("http")) {
    console.log(chunk);
    console.log("---");
  }
}
