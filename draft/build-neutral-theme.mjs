/* 生成「素灰」中性主题预览稿。
   底座是 v3 视觉稿（todo/20261102-TP6-视觉重构与优化/design-v3），本脚本只做三件事：
   1. 把 base 的 CSS/JS 复制到 draft/neutral-theme/_base/（自包含，方便单独打开与归档）；
   2. 在 index.html 里追加 neutral.css 与皮肤切换条；
   3. 落 data-skin="neutral" 作初始皮肤。

   用法：node draft/build-neutral-theme.mjs
   注意：index.html 是生成物，勿手改；改样式改 neutral.css，改底座改 design-v3。 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const base = join(here, "..", "todo", "20261102-TP6-视觉重构与优化", "design-v3");
const out = join(here, "neutral-theme");
const outBase = join(out, "_base");

const CSS = [
  "style.css", "tokens-base.css", "shell.css", "memo-note.css",
  "table-spec.css", "components.css", "home-settings.css",
  "completion.css", "table-settings.css",
];

if (!existsSync(join(base, "index.html"))) {
  console.error("找不到底座 design-v3/index.html：" + base);
  process.exit(1);
}
mkdirSync(outBase, { recursive: true });

for (const f of [...CSS, "app.js"]) copyFileSync(join(base, f), join(outBase, f));

let html = readFileSync(join(base, "index.html"), "utf8");

/* 初始皮肤：中性；data-theme 保持底座默认 */
if (!/<html[^>]*data-skin=/.test(html)) {
  html = html.replace(/<html([^>]*)>/, '<html$1 data-skin="neutral">');
}

/* 资源指向 _base，并在入口样式后叠加 neutral.css */
html = html.replace(
  '<link rel="stylesheet" href="style.css">',
  '<link rel="stylesheet" href="_base/style.css">\n<link rel="stylesheet" href="neutral.css">'
);
html = html.replace('<script src="app.js" defer></script>',
  '<script src="_base/app.js" defer></script>\n<script src="skin-switch.js" defer></script>');

/* 标题栏点明这是草案 */
html = html.replace(/<title>[^<]*<\/title>/, "<title>Menote · 素灰（中性主题草案）</title>");

writeFileSync(join(out, "index.html"), html, "utf8");
console.log("已生成 " + join(out, "index.html"));
