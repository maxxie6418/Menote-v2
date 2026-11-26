import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

test("shows local text during editor startup and opens the latest synced body", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
  for (const key of ["window", "document", "HTMLElement", "Element", "MutationObserver"]) globalThis[key] = dom.window[key];
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  globalThis.MessageChannel = class {
    port1 = { onmessage: null };
    port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const bundle = await build({
    stdin: { contents: `
      export { act, createElement } from "react";
      export { createRoot } from "react-dom/client";
      export { NoteEditor } from "./src/features/editor/NoteEditor";
    `, resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
    bundle: true, write: false, format: "esm", platform: "browser",
    plugins: [{ name: "deferred-editor", setup(builder) {
      builder.onResolve({ filter: /^\.\/milkdownAdapter$/ }, () => ({ path: "adapter", namespace: "deferred-editor" }));
      builder.onLoad({ filter: /.*/, namespace: "deferred-editor" }, () => ({
        contents: "export const MilkdownWysiwygAdapter = { create: (...args) => globalThis.createDeferredEditor(...args) };",
      }));
    } }],
  });
  const { act, createElement, createRoot, NoteEditor } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
  );
  let completeEditor;
  globalThis.createDeferredEditor = (host, { initialMarkdown, onInput }) => new Promise((resolve) => {
    completeEditor = () => {
      host.textContent = initialMarkdown;
      resolve({
        getMarkdown: () => host.textContent,
        loadMarkdown: (markdown) => { host.textContent = markdown; onInput(); },
        destroy: () => { host.textContent = ""; },
      });
    };
  });
  let readMarkdown;
  let inputCount = 0;
  const root = createRoot(document.getElementById("root"));
  const render = (markdown) => root.render(createElement(NoteEditor, {
    mode: "edit", kind: "wysiwyg", externalMarkdown: markdown, inspectorOutline: true,
    loadingPreview: createElement("p", { className: "mn-doc-preview" }, markdown),
    onInput: () => { inputCount += 1; },
    registerGetMarkdown: (get) => { readMarkdown = get; },
    registerApplyExternal() {},
  }));
  try {
    await act(async () => render("本地正文"));
    assert.equal(document.querySelector(".mn-doc-preview")?.textContent, "本地正文");
    assert.equal(document.querySelector(".mn-editor-host").hidden, true);
    assert.equal(readMarkdown, undefined);
    assert.equal(typeof completeEditor, "function");

    await act(async () => render("同步后的正文"));
    assert.equal(document.querySelector(".mn-doc-preview")?.textContent, "同步后的正文");
    await act(async () => completeEditor());
    assert.equal(document.querySelector(".mn-doc-preview"), null);
    assert.equal(document.querySelector(".mn-editor-host").hidden, false);
    assert.equal(readMarkdown(), "同步后的正文");
    assert.equal(inputCount, 0);
  } finally {
    await act(async () => root.unmount());
    delete globalThis.createDeferredEditor;
    dom.window.close();
  }
});
