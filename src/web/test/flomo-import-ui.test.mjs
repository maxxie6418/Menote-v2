import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { zipSync, strToU8 } from "fflate";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "CustomEvent", "Event", "MouseEvent"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.MessageChannel = class { port1 = { onmessage: null }; port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.DOMParser = dom.window.DOMParser;

const bundle = await build({
  stdin: {
    contents: `export { createElement, act } from "react";
      export { createRoot } from "react-dom/client";
      export { FlomoImportPanel } from "./src/features/import/FlomoImportPanel";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createElement, act, createRoot, FlomoImportPanel } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

function buildZip() {
  const html = `<html><body><div class="memos">
    <div class="memo" data-tags="[&quot;工作&quot;]">
      <div class="time">2025-08-26 22:44:23</div>
      <div class="content"><p>负责的内容最纪要跟踪进度 #工作 </p></div>
      <div class="files"></div>
    </div>
    <div class="memo" data-tags="[]">
      <div class="time">2024-06-17 15:59:03</div>
      <div class="content"><p>一张图</p></div>
      <div class="files"><img src="file/2024-06-17/6645/photo.jpg" alt="memo image" /></div>
    </div>
  </div></body></html>`;
  return zipSync({
    "flomo@tester-20261116/tester的笔记.html": strToU8(html),
    "flomo@tester-20261116/file/2024-06-17/6645/photo.jpg": new Uint8Array([1, 2, 3, 4]),
  });
}

async function settle(predicate) {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (predicate()) return;
  }
  assert.fail(`UI did not settle: ${document.body.textContent}`);
}

function mountPanel() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

test("选包后先看摘要与预览，确认按钮才出现", async () => {
  const { container, root } = mountPanel();
  await act(async () => { root.render(createElement(FlomoImportPanel, { userId: "user-a" })); });

  const input = container.querySelector('input[type="file"]');
  assert.ok(input);
  const file = new File([buildZip()], "flomo@tester-20261116.zip", { type: "application/zip" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });

  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await settle(() => container.textContent.includes("2 条"));

  const text = container.textContent;
  assert.ok(text.includes("2 条"), text);
  assert.ok(text.includes("工作"), text);
  assert.ok(text.includes("1 张"), text);
  assert.ok(text.includes("负责的内容最纪要跟踪进度"), text);
  const confirm = [...container.querySelectorAll("button")].find((element) => element.textContent.includes("开始导入"));
  assert.ok(confirm, "应出现开始导入按钮");
});

test("不是压缩包时给出提示，不进入导入流程", async () => {
  const { container, root } = mountPanel();
  await act(async () => { root.render(createElement(FlomoImportPanel, { userId: "user-a" })); });

  const input = container.querySelector('input[type="file"]');
  const file = new File([new Uint8Array([1, 2, 3])], "broken.zip", { type: "application/zip" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });

  await act(async () => { input.dispatchEvent(new dom.window.Event("change", { bubbles: true })); });
  await settle(() => container.textContent.includes("无法解析"));

  assert.ok(container.textContent.includes("无法解析"));
  assert.equal([...container.querySelectorAll("button")].some((element) => element.textContent.includes("开始导入")), false);
});
