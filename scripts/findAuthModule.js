import fs from "node:fs";
import path from "node:path";

const dir = "scripts/.probe-cache";
for (const file of fs.readdirSync(dir)) {
  if (!file.endsWith(".js")) continue;
  const s = fs.readFileSync(path.join(dir, file), "utf8");
  if (s.includes("authUrl") && s.includes("authenticate")) {
    const i = s.indexOf("authUrl");
    console.log(file, s.slice(i, i + 180));
  }
  if (s.includes("W0=") || s.includes("W0:")) {
    const i = s.indexOf("W0");
    console.log(file, "W0", s.slice(i, i + 120));
  }
}
