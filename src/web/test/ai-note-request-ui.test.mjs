import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Element", "CustomEvent", "Event", "MouseEvent"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.MessageChannel = class { port1 = { onmessage: null }; port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) }; };
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.BroadcastChannel = undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const resolveDir = fileURLToPath(new URL("..", import.meta.url));
const bundle = await build({
  stdin: { contents: `export { createElement, act, useState } from "react";
    export { createRoot } from "react-dom/client";
    export { NoteDocument } from "./src/features/notes/NoteDocument";`, resolveDir },
  bundle: true, write: false, format: "esm", platform: "browser",
  plugins: [{ name: "controlled-note-dependencies", setup(builder) {
    builder.onResolve({ filter: /^\.\.\/\.\.\/services\/contentHooks$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    builder.onLoad({ filter: /contentHooks$/, namespace: "stub" }, () => ({ contents: `export function useItem(_userId, id) { return id === globalThis.__note?.id ? globalThis.__note : undefined; } export function useLockVersion() {} export function useSyncQueueStatus() { return { pending: 0, failed: 0 }; }`, loader: "js" }));
    builder.onResolve({ filter: /^\.\.\/(editor|ai)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
    builder.onLoad({ filter: /editor$/, namespace: "stub" }, () => ({ contents: `export function NoteEditor() { return null; } export function OutlinePanel() { return null; } export function remarkTextColorForRender() {}`, loader: "js" }));
    builder.onLoad({ filter: /ai$/, namespace: "stub" }, () => ({ contents: `import { createElement } from "react";
      export function AiAssistDialog({ markdown, onClose }) { return createElement("div", { role: "dialog" }, createElement("output", null, markdown), createElement("button", { onClick: onClose }, "关闭")); }`, loader: "js", resolveDir }));
  }}],
});
const { createElement, act, useState, createRoot, NoteDocument } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const note = { id: "note-b", type: "note", title: "B", tags: [], content: { scope: "plain", markdown: "---\nsummary: 旧概述\n---\n\nB 的正文" },
  createdAt: Date.now(), updatedAt: Date.now(), topicId: null, groupId: null, source: "manual", rev: 1, metaRev: 1 };

test("list request waits for the selected note and is consumed before returning to it", async () => {
  const consumed = [];
  let setCurrent;
  function Harness() {
    const [current, changeCurrent] = useState("note-b");
    const [request, setRequest] = useState({ id: "note-b", token: 123 });
    setCurrent = changeCurrent;
    return createElement(NoteDocument, { key: current, userId: "user", noteId: current, topics: [], onBack() {}, showBack: false, crumb: "清单",
      openSummaryToken: request?.id === current ? request.token : undefined,
      onSummaryRequestConsumed(token) { consumed.push(token); setRequest((value) => value?.token === token && value.id === current ? null : value); },
    });
  }
  const root = createRoot(document.getElementById("root"));
  try {
    globalThis.__note = undefined;
    await act(async () => root.render(createElement(Harness)));
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.deepEqual(consumed, [], "正文未加载时不得消费请求");
    globalThis.__note = note;
    await act(async () => root.render(createElement(Harness)));
    assert.equal(document.querySelector('[role="dialog"] output')?.textContent, note.content.markdown, "面板取得目标笔记的完整正文");
    assert.deepEqual(consumed, [123]);
    await act(async () => document.querySelector('[role="dialog"] button').click());
    await act(async () => setCurrent("note-a"));
    await act(async () => setCurrent("note-b"));
    assert.equal(document.querySelector('[role="dialog"]'), null, "返回时不应重新打开已消费的请求");
    assert.deepEqual(consumed, [123]);
  } finally {
    await act(async () => root.unmount());
    delete globalThis.__note;
    dom.window.close();
  }
});
