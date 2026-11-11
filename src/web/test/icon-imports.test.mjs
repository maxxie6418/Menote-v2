import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// lucide-react 主入口把 4550 个图标文件全部 re-export，rollup 必须逐个读取解析才能
// tree-shaking。本地能扛，Cloudflare 构建容器扛不住（2026-11-11 EMFILE 构建失败）。
// 图标一律经 src/icons.ts 走 lucide-react/icons/<kebab> 子路径；类型可用 import type。

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const ICONS_ENTRY = "icons.ts";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("lucide 图标只经 icons.ts 的子路径导入，不加载主入口", () => {
  const violations = [];
  // 只匹配运行时具名导入；import type 会被构建擦除，不触发模块加载，允许。
  const barrel = /import\s+(?!type\s)[^;]*?from\s*["']lucide-react["']/g;

  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).replace(/\\/g, "/");
    if (rel === ICONS_ENTRY) continue;
    const text = readFileSync(file, "utf8");
    if (barrel.test(text)) violations.push(rel);
    barrel.lastIndex = 0;
  }

  assert.deepEqual(violations, [], "以下文件直接导入了 lucide-react 主入口，请改为从 ../icons 取图标");
});

test("icons.ts 全部走 icons/<kebab> 子路径，且不含主入口导入", () => {
  const text = readFileSync(join(SRC, ICONS_ENTRY), "utf8");
  const lines = text.split("\n").filter((line) => line.trim().startsWith("export {"));
  assert.ok(lines.length > 0, "icons.ts 应当导出图标");

  const bad = lines.filter((line) => !/from "lucide-react\/icons\/[a-z0-9-]+"/.test(line));
  assert.deepEqual(bad, [], "icons.ts 存在未走子路径的导出行");
});
