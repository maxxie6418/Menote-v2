// W3b 接入验证（FR-EDT-10）：在 jsdom 中用真实 Milkdown 验证「键入路径不再整篇序列化」。
// 运行：node --test poc/typing-check.mjs（在 src/web 下）（不在 pnpm test 套件内，属接入证据）
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

// jsdom 没有布局引擎：ProseMirror 的坐标/滚动计算会用到 Range 与 Element 的 getClientRects，
// jsdom 未实现（调用即抛 TypeError）。这里补一个全零矩形——全零会被 scrollRectIntoView 直接跳过。
const zeroRect = () => ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 });
dom.window.Range.prototype.getClientRects = () => [];
dom.window.Range.prototype.getBoundingClientRect = zeroRect;
dom.window.Element.prototype.getClientRects = () => [];
dom.window.Element.prototype.getBoundingClientRect = zeroRect;

const bundle = await build({
  entryPoints: [new URL("./typing-entry.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("改动正文时不触发序列化器（键入路径不再整篇序列化）", async () => {
  const result = await harness.runTypingScenario();
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.applied, true, "加粗应当生效");
  assert.ok(
    !result.bucketsAfterEdit.includes("editor.serialize"),
    `改动正文不该触发序列化：${result.bucketsAfterEdit.join(",")}`,
  );
});

test("显式取正文时才序列化（指标 editor.serialize 保留）", async () => {
  const result = await harness.runTypingScenario();
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(
    result.bucketsAfterPreserved.includes("editor.serialize"),
    `取持久化文本时才序列化：${result.bucketsAfterPreserved.join(",")}`,
  );
});

test("脏信号会发出（onInput 只表示「正文变了」）", async () => {
  const result = await harness.runTypingScenario();
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.dirtyCountAfterDebounce >= 1, `脏信号应发出：${result.dirtyCountAfterDebounce}`);
});

test("按键 → 变更被感知（指标 editor.keyToChange）", async () => {
  const result = await harness.runTypingScenario();
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(
    result.bucketsAfterDebounce.includes("editor.keyToChange"),
    `应记录 editor.keyToChange：${result.bucketsAfterDebounce.join(",")}`,
  );
});

test("防抖窗口内取持久化文本也拿到新内容（新鲜度靠 doc 比较，不靠事件）", async () => {
  const result = await harness.runTypingScenario();
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.preservedImmediately.includes("**abc**"), `应已是新内容：${result.preservedImmediately}`);
  assert.ok(!result.preservedImmediately.includes("abc def"), `不该是旧内容：${result.preservedImmediately}`);
});

test("「/」菜单上下文走原生选区：行首 / 命中并给出过滤词", async () => {
  const result = await harness.runSlashScenario("/ta\n", 3);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.deepEqual(result.context, { query: "ta" });
});

test("「/」菜单上下文：句子中间的斜杠不触发", async () => {
  const result = await harness.runSlashScenario("abc /ta\n", 7);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.context, null);
});

test("「/」菜单上下文：列表项里不触发（Markdown 行首是 '- '）", async () => {
  const result = await harness.runSlashScenario("- item\n", 0);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.equal(result.context, null);
});
