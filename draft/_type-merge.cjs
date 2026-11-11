// 字号体系收敛：9.5(kicker) / 10( micro) / 10.5(label) / 11(sechead) 四档并入 11.5(chip) 与 12(nav)。
// 只做字面替换，替换后由 grep 复查是否有遗漏。
const fs = require("fs");
const path = require("path");

const ROOT = "F:/Git/Menote-v2/src/web/src";
const MAP = [
  ["var(--app-size-kicker)", "var(--app-size-chip)"],
  ["var(--app-size-micro)", "var(--app-size-chip)"],
  ["var(--app-size-sechead)", "var(--app-size-chip)"],
  ["var(--app-size-label)", "var(--app-size-nav)"],
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

let total = 0;
const perFile = [];
for (const file of walk(ROOT)) {
  let text = fs.readFileSync(file, "utf8");
  let hits = 0;
  for (const [from, to] of MAP) {
    const count = text.split(from).length - 1;
    if (count) { text = text.split(from).join(to); hits += count; }
  }
  if (hits) {
    fs.writeFileSync(file, text, "utf8");
    perFile.push(`${path.relative(ROOT, file).replace(/\\/g, "/")}  ${hits}`);
    total += hits;
  }
}
console.log(perFile.join("\n"));
console.log("共替换", total, "处");
