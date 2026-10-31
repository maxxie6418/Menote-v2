// E4 编辑器往返 PoC（FR-EDT-5 准入）：Milkdown 语料逐字节 diff，按损坏等级分类。
// 运行：node --test poc/milkdown-poc.mjs（在 src/web 下）（不在 pnpm test 套件内，属准入证据）
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

const dom = new JSDOM("<!doctype html><html><body><div id='host'></div></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.Node = dom.window.Node;
globalThis.getSelection = () => dom.window.getSelection();
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
// 事件类统一指向 jsdom realm：混合 realm 的 Event 会被 jsdom dispatchEvent 品牌检查拒绝
for (const name of ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent",
  "CompositionEvent", "ClipboardEvent", "MessageEvent", "UIEvent", "EventTarget", "DocumentFragment"]) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const bundle = await build({
  entryPoints: [new URL("./harness-entry.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

/** 语料：GFM 表格/代码块/附件引用/HTML/脚注/未知语法/任务列表/嵌套列表/标记变体。
 *  frontmatter 不进语料——架构上由属性区在编辑器外管理（FR-PROP-1），编辑器只处理正文。 */
const CORPUS = [
  ["gfm-table", "| 名称 | 数量 | 备注 |\n| --- | --- | --- |\n| 苹果 | 3 | 红 |\n| 香蕉 | 12 | 黄 |\n"],
  ["fenced-code", "```ts\nconst a = 1;\nfunction f() { return a; }\n```\n"],
  ["code-indent-vs-fence", "前文\n\n    缩进代码块\n\n后文\n"],
  ["attachment-ref", "看图：\n\n![截图](attachments/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789--shot.png)\n\n完。\n"],
  ["html-fragment", "段落 <b>加粗</b> 与 <span class=\"x\">片段</span>。\n\n<div>\n  块级 HTML\n</div>\n"],
  ["footnote", "有脚注[^1]的段落。\n\n[^1]: 脚注内容\n"],
  ["unknown-directive", "::: tip\n提示内容\n:::\n"],
  ["task-list", "- [ ] 未完成\n- [x] 已完成\n"],
  ["nested-list", "- 一层\n  - 二层\n    - 三层\n- 回到一层\n"],
  ["marker-variants", "* 星号项\n+ 加号项\n- 减号项\n"],
  ["emphasis-variants", "*星强调* 与 _下划强调_ 与 **粗** 与 __下划粗__\n"],
  ["setext-heading", "标题一\n=====\n\n标题二\n-----\n"],
  ["hard-break", "行尾两空格  \n下一行\n"],
  ["blockquote", "> 引用一行\n> 引用两行\n"],
  ["autolink-escape", "访问 <https://example.com> 与转义 \* 不斜体\n"],
];

test("Milkdown round-trip corpus byte-diff (FR-EDT-5 准入证据)", async (t) => {
  const report = [];
  const evidence = [];
  for (const [name, source] of CORPUS) {
    let output;
    try {
      output = await harness.roundTrip(source);
      evidence.push({ name, source, output });
    } catch (error) {
      report.push({ name, verdict: "P0-损坏", diff: `编辑器异常: ${String(error).slice(0, 160)}` });
      continue;
    }
    if (typeof output !== "string") {
      report.push({ name, verdict: "P0-损坏", diff: `序列化返回非字符串: ${typeof output}` });
      continue;
    }
    const verdict = output === source ? "IDENTICAL" : classify(source, output);
    report.push({ name, verdict, diff: output === source ? "" : firstDiff(source, output) });
  }
  for (const entry of report) {
    console.log(`[${entry.verdict}] ${entry.name}${entry.diff ? "\n  " + entry.diff : ""}`);
  }
  const p0 = report.filter((entry) => entry.verdict === "P0-损坏");
  const p1 = report.filter((entry) => entry.verdict === "P1-规范化");
  t.diagnostic(`P0 损坏 ${p0.length} 项：${p0.map((entry) => entry.name).join(", ") || "无"}；P1 规范化 ${p1.length} 项：${p1.map((entry) => entry.name).join(", ") || "无"}`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(new URL("./evidence.json", import.meta.url), JSON.stringify(evidence, null, 2));
  // 准入判定：P0（内容丢失/损坏）必须为 0；P1（等价规范化）允许并列入 M3 打磨。
  assert.deepEqual(p0.map((entry) => entry.name), [], "存在内容损坏项，FR-EDT-5 准入失败");
});

function classify(source, output) {
  // 语义等价的规范化（空白/标题 ATX/列表标记/强调符号/硬换行风格）记 P1；
  // 可见内容丢失（行缺失或大幅缩水）记 P0，须人工复核 diff 定级。
  const strip = (text) => text.replace(/\s+/g, "").replace(/[#>*_+~`=-]/g, "").split('\\').join("");
  if (strip(source) === strip(output)) return "P1-规范化";
  if (output.trim().length < source.trim().length * 0.8) return "P0-损坏";
  const sourceLines = source.split("\n").filter((line) => line.trim());
  const outputLines = output.split("\n").filter((line) => line.trim());
  if (sourceLines.length > outputLines.length) return "P0-损坏";
  return "P1-规范化";
}

function firstDiff(source, output) {
  const a = source.split("\n");
  const b = output.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return `行${i + 1}  源: ${JSON.stringify(a[i] ?? "")} → 出: ${JSON.stringify(b[i] ?? "")}`;
  }
  return "";
}
