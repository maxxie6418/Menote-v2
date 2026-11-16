import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "CustomEvent", "Event", "MouseEvent"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.MessageChannel = class { port1 = { onmessage: null }; port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.DOMParser = dom.window.DOMParser;

/** 浏览器行为：IntersectionObserver 的 rootMargin 只接受 px 或 %，给 rem 会抛 SyntaxError。
 *  这里如实复刻，替掉 jsdom 缺失的实现（图册白屏的根因就在这条规则上）。 */
class StrictIntersectionObserver {
  constructor(_callback, options) {
    const rootMargin = options?.rootMargin ?? "0px";
    if (!/^(-?[\d.]+)(px|%)$/.test(rootMargin)) {
      throw new SyntaxError("Failed to construct 'IntersectionObserver': rootMargin must be specified in pixels or percent.");
    }
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
globalThis.IntersectionObserver = StrictIntersectionObserver;
dom.window.IntersectionObserver = StrictIntersectionObserver;

const bundle = await build({
  stdin: {
    contents: `export { createElement, act } from "react";
      export { createRoot } from "react-dom/client";
      export { MemoGallery } from "./src/features/memo/MemoGallery";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createElement, act, createRoot, MemoGallery } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const images = [
  { memoId: "memo-1", sha256: "a".repeat(64), createdAt: 1763200000000, tag: "工作" },
  { memoId: "memo-2", sha256: "b".repeat(64), createdAt: 1763100000000, tag: null },
];

/** 图册有图时构造观察器；rootMargin 非法会抛错并把整棵树打崩（整页白屏）。 */
test("图册有图时不会因观察器参数非法而崩掉整页", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(" ")); };
  let thrown = null;
  try {
    await act(async () => {
      root.render(createElement(MemoGallery, { images, onOpen: () => {} }));
    });
  } catch (cause) {
    thrown = cause;
  } finally {
    console.error = originalError;
  }

  const fatal = errors.filter((line) => line.includes("rootMargin must be specified in pixels or percent"));
  assert.deepEqual(fatal, [], "不应出现 rootMargin 参数非法的报错");
  assert.ok(thrown === null, `渲染抛出异常：${thrown ? String(thrown).slice(0, 120) : ""}`);
  assert.equal(container.querySelectorAll(".mn-memo-gal-item").length, 2, "图册应渲染出两个图位");
});

test("图册没有图时给出空态提示", async () => {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(MemoGallery, { images: [], onOpen: () => {} })); });
  assert.ok(container.textContent.includes("还没有图片"), container.textContent);
});
