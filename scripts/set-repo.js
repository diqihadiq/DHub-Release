// Pakai: npm run set-repo -- username/nama-repo   (mengisi build.publish di package.json untuk auto-update)
const fs = require("fs");
const m = /^([\w.-]+)\/([\w.-]+)$/.exec(process.argv[2] || "");
if (!m) { console.error("Format: npm run set-repo -- username/nama-repo"); process.exit(1); }
const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
p.build.publish = [{ provider: "github", owner: m[1], repo: m[2], releaseType: "release" }];
fs.writeFileSync("package.json", JSON.stringify(p, null, 2));
console.log("OK: auto-update diarahkan ke github.com/" + m[1] + "/" + m[2]);
