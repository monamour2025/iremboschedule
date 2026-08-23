import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main.js", "utf8");
for (const term of ["AuthInterceptor", "intercept(D", "record/external", "423", "ignoreAuthToken", "X-Origin"]) {
  let idx = 0;
  let n = 0;
  while ((idx = s.indexOf(term, idx + 1)) !== -1 && n < 2) {
    console.log("\n===", term, n++, "===");
    console.log(s.slice(idx - 80, idx + 350));
  }
}
