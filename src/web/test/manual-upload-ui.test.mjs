import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "CustomEvent", "Event", "MouseEvent"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
// 浏览器版 React 的 act/scheduler 使用 MessageChannel；避免 Node 原生端口保持测试进程存活。
globalThis.MessageChannel = class {
  port1 = { onmessage: null };
  port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
};
globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
globalThis.BroadcastChannel = undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bundle = await build({
  stdin: {
    contents: `export { createElement, act } from "react";
      export { createRoot } from "react-dom/client";
      export { SidebarSyncControl } from "./src/features/sync/SidebarSyncControl";
      export { localDb } from "./src/db/localDb";
      export { createNote } from "./src/services/contentService";
      export { registerEditorSave, notifyEditorChange } from "./src/services/editorSaveService";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createElement, act, createRoot, SidebarSyncControl, localDb, createNote, registerEditorSave, notifyEditorChange } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function settle(predicate) {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (predicate()) return;
  }
  assert.fail(`UI did not settle: ${document.body.textContent}`);
}

test("manual control shows all-uploaded only after saving and clears the result on further edits", async () => {
  await localDb.meta.put({ key: "appearanceLegacyImported", value: true });
  let saved = false;
  const unregister = registerEditorSave("ui-user", async () => { saved = true; return true; });
  globalThis.fetch = async (url, options) => {
    assert.equal(saved, true, "必须先等本地保存成功");
    if (String(url).includes("/push")) return { ok: true, status: 200, json: async () => ({
      results: JSON.parse(options.body).operations.map((row) => ({ operationId: row.operationId, result: "applied", rev: 1, metaRev: 1 })),
    }) };
    return { ok: true, status: 200, json: async () => ({ items: [], topics: [], memoComments: [], settings: [], nextCursor: "1" }) };
  };
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => { root.render(createElement(SidebarSyncControl, { userId: "ui-user", collapsed: false })); });
    await act(async () => { root.render(createElement(SidebarSyncControl, { userId: "ui-user", collapsed: true })); });
    assert.match(document.querySelector("button").getAttribute("aria-label"), /已同步.*立即同步/);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    assert.equal(document.querySelector("button").disabled, true);
    assert.match(document.querySelector("button").getAttribute("aria-label"), /离线，等待联网/);
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    await act(async () => { window.dispatchEvent(new Event("online")); root.render(createElement(SidebarSyncControl, { userId: "ui-user", collapsed: false })); });
    await act(async () => { document.querySelector("button").click(); });
    await settle(() => document.querySelector("[role=status]").textContent === "已全部上传");
    assert.equal(document.querySelector("button").disabled, false);
    await act(async () => { notifyEditorChange(); });
    assert.notEqual(document.querySelector("[role=status]").textContent, "已全部上传");
    await act(async () => { await createNote("ui-user", { title: "新的本地修改" }); });
    await settle(() => document.querySelector("[role=status]").textContent.includes("项待上传"));

    // 保存失败时留在可重试状态，不能因上传队列恰好为空而报告成功。
    unregister();
    const fail = registerEditorSave("ui-user", async () => false);
    await act(async () => { document.querySelector("button").click(); });
    await settle(() => document.querySelector("[role=status]").textContent === "上传失败，请重试");
    assert.equal(document.querySelector("button").disabled, false);
    fail();
    await act(async () => { document.querySelector("button").click(); });
    await settle(() => document.querySelector("[role=status]").textContent === "已全部上传");
  } finally {
    unregister();
    await act(async () => { root.unmount(); });
    localDb.close();
    dom.window.close();
  }
});
