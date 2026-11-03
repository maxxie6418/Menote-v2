// W1 接入验证（FR-EDT-8）：在 jsdom 中用真实 Milkdown 走一遍「编辑 → 保存 → 回填原文」。
// 运行：node --test poc/guard-check.mjs（在 src/web 下）（不在 pnpm test 套件内，属接入证据）
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.Node = dom.window.Node;
globalThis.getSelection = () => dom.window.getSelection();
globalThis.addEventListener = dom.window.addEventListener.bind(dom.window);
globalThis.removeEventListener = dom.window.removeEventListener.bind(dom.window);
globalThis.dispatchEvent = dom.window.dispatchEvent.bind(dom.window);
for (const name of ["Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "InputEvent", "FocusEvent",
  "CompositionEvent", "ClipboardEvent", "UIEvent", "EventTarget", "DocumentFragment"]) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const bundle = await build({
  entryPoints: [new URL("./guard-entry.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const SOURCE = [
  "| 名称 | 数量 |",
  "| --- | --- |",
  "| 苹果 | 3 |",
  "",
  "- 甲项",
  "- 乙项",
  "",
  "结尾段落。",
  "",
].join("\n");

const EDITED = SOURCE.replace("结尾段落。", "结尾段落改。");

test("规范文本确实被序列化器改写（证明回填有意义）", async () => {
  const result = await harness.guardRoundTrip(SOURCE, EDITED);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.canonical.includes("| -- | -- |"), `规范文本应有短分隔行：${result.canonical}`);
  assert.ok(result.canonical.includes("* 甲项"), `规范文本应换成星号列表：${result.canonical}`);
});

test("未触碰的表格与列表回填原始字节", async () => {
  const result = await harness.guardRoundTrip(SOURCE, EDITED);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.preserved.includes("| --- | --- |"), `分隔行未回填：${result.preserved}`);
  assert.ok(result.preserved.includes("| 苹果 | 3 |"), `单元格填充未回填：${result.preserved}`);
  assert.ok(result.preserved.includes("- 甲项"), `列表符号未回填：${result.preserved}`);
  assert.ok(result.preserved.includes("- 乙项"), `列表符号未回填：${result.preserved}`);
});

test("改动的那一段用新文本", async () => {
  const result = await harness.guardRoundTrip(SOURCE, EDITED);
  assert.ok(result.preserved.includes("结尾段落改。"), `改动未保留：${result.preserved}`);
  assert.ok(!result.preserved.includes("结尾段落。\n"), "旧段落不应残留");
});

test("等价判断：规范文本与回填文本都算「当前内容」", async () => {
  const result = await harness.guardRoundTrip(SOURCE, EDITED);
  assert.equal(result.sameCanonical, true);
  assert.equal(result.samePreserved, true);
});

test("光标落在列表内部不再抛错（Milkdown gfm 序列化器缺陷的兜底）", async () => {
  const result = await harness.guardRoundTrip("- 甲项\n- 乙项\n\n结尾段落。\n", "- 甲项\n- 乙项\n\n结尾段落。\n");
  assert.equal(result.error, undefined, result.error ?? "");
});
