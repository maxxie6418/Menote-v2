import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "CustomEvent", "Event", "MouseEvent"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.MessageChannel = class {
  port1 = { onmessage: null };
  port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Keep the actual dialog and HTTP client while controlling settings and sync locally.
const bundle = await build({
  stdin: {
    contents: `export { createElement, act } from "react";
      export { createRoot } from "react-dom/client";
      export { AiAssistDialog } from "./src/features/ai/AiAssistDialog";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  plugins: [{
    name: "controlled-dialog-dependencies",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/\.\.\/services\/(aiSettingsService|syncEngine)$/ }, (args) => ({ path: args.path, namespace: "stub" }));
      builder.onLoad({ filter: /aiSettingsService$/, namespace: "stub" }, () => ({ contents: 'export async function readAiSettings() { return { enabled: true }; }', loader: "js" }));
      builder.onLoad({ filter: /syncEngine$/, namespace: "stub" }, () => ({ contents: 'export async function flushSync() {}', loader: "js" }));
    },
  }],
});
const { createElement, act, createRoot, AiAssistDialog } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function settle(predicate) {
  for (let i = 0; i < 100; i++) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    if (predicate()) return;
  }
  assert.fail(`UI did not settle: ${document.body.textContent}`);
}

function button(label) {
  return [...document.querySelectorAll("button")].find((element) => element.textContent.includes(label));
}

test("opening and reopening the AI dialog is idle; each command submits only when selected", async () => {
  const requests = [];
  let applied = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === "/api/ai/usage") return { ok: true, json: async () => ({ usage: { day: "2026-11-13", calls: 0, inputTokens: 0, outputTokens: 0, dailyCallLimit: 50, freeNeuronsDaily: 10000 } }) };
    assert.equal(String(url), "/api/ai/tasks");
    assert.equal(options.method, "POST");
    const request = JSON.parse(options.body);
    requests.push(request);
    return { ok: true, json: async () => ({ task: {
      id: `task-${requests.length}`, itemId: request.itemId, kind: request.kind, status: "done", reused: false,
      result: request.kind === "summary" ? { type: "summary", summary: "建议概述" } : { type: "tags", tags: ["新标签"] },
    } }) };
  };
  const root = createRoot(document.getElementById("root"));
  const props = {
    userId: "user", itemId: "note", title: "测试笔记", tags: [], markdown: "---\ntitle: 测试\n---\n正文内容",
    onApplySummary: async () => { applied++; return true; },
    onApplyTags: async () => { applied++; },
    onClose: () => root.render(null),
  };
  try {
    await act(async () => { root.render(createElement(AiAssistDialog, props)); });
    await settle(() => button("生成概述") && button("推荐标签"));
    assert.equal(requests.length, 0, "打开面板不能提交任务");

    await act(async () => { button("生成概述").click(); });
    await settle(() => document.body.textContent.includes("建议概述"));
    assert.deepEqual(requests.map((request) => request.kind), ["summary"]);
    assert.equal(requests[0].content, "正文内容", "提交正文不包含 YAML 属性");
    assert.equal(applied, 0, "生成结果不能自动写入");

    await act(async () => { button("推荐标签").click(); });
    await settle(() => document.body.textContent.includes("#新标签"));
    assert.deepEqual(requests.map((request) => request.kind), ["summary", "tags"]);
    assert.equal(applied, 0, "标签建议不能自动写入");

    await act(async () => { document.querySelector('[aria-label="关闭"]').click(); });
    await act(async () => { root.render(createElement(AiAssistDialog, props)); });
    await settle(() => button("生成概述") && button("推荐标签"));
    assert.deepEqual(requests.map((request) => request.kind), ["summary", "tags"], "重新打开面板不能提交任务");
  } finally {
    await act(async () => { root.unmount(); });
    dom.window.close();
  }
});
