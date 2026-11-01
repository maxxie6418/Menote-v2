// MilkdownWysiwygAdapter 回归测试（jsdom 走真实适配器路径——覆盖 config 期正确性）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fileURLToPath, pathToFileURL } from "node:url";
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
  "CompositionEvent", "ClipboardEvent", "MessageEvent", "UIEvent", "EventTarget"]) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.matchMedia = dom.window.matchMedia?.bind(dom.window) ?? (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/features/editor/milkdownAdapter.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
// 大 bundle 经临时文件加载，避免超长 data URI 的内存分配。
const { writeFile, readFile, rm } = await import("node:fs/promises");
const outPath = fileURLToPath(new URL("./editor-adapter.bundle.tmp.mjs", import.meta.url));
await writeFile(outPath, bundle.outputFiles[0].text);
const { MilkdownWysiwygAdapter } = await import(pathToFileURL(outPath).href);

test("adapter mounts the editor and round-trips markdown", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const inputs = [];
  const adapter = await MilkdownWysiwygAdapter.create(host, {
    initialMarkdown: "- 项目\n",
    onInput: (value) => inputs.push(value),
  });
  assert.match(adapter.getMarkdown(), /项目/);
  assert.equal(host.querySelector(".ProseMirror") !== null, true, "ProseMirror 视图已挂载");
  adapter.loadMarkdown("# 标题\n\n正文。\n");
  assert.match(adapter.getMarkdown(), /标题/);
  adapter.destroy();
  assert.equal(host.querySelector(".ProseMirror"), null, "销毁后视图移除");
  await rm(outPath, { force: true });
});

test("markdownUpdated listener fires on content replacement", async () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const inputs = [];
  const adapter = await MilkdownWysiwygAdapter.create(host, {
    initialMarkdown: "初始内容\n",
    onInput: (value) => inputs.push(value),
  });
  adapter.loadMarkdown("替换后的内容\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(inputs.includes("替换后的内容\n"), `onInput 应收到替换内容，实际: ${JSON.stringify(inputs)}`);
  adapter.destroy();
});
