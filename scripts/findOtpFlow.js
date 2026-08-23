import fs from "node:fs";

const s = fs.readFileSync("scripts/.probe-cache/main.js", "utf8");
for (const term of ["OTP", "otpValue", "60013", "100000", "twoFa", "2fa"]) {
  let idx = 0, n = 0;
  while ((idx = s.indexOf(term, idx + 1)) !== -1 && n < 1) {
    console.log("\n", term, s.slice(idx - 50, idx + 150));
    n++;
  }
}
