import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "MutationObserver", "sessionStorage"]) globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.MessageChannel = class {
  port1 = { onmessage: null };
  port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const bundle = await build({
  stdin: { contents: `
    export { act, createElement, useLayoutEffect } from "react";
    export { createRoot } from "react-dom/client";
    export * from "./src/features/notes/useNoteViewPosition";
    export * from "./src/lib/noteViewPosition";
  `, resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const {
  act, createElement, useLayoutEffect, createRoot, useNoteViewPosition, saveBeforeNoteViewChange,
  sourceBlockOffsets, notePositionKey, readNotePosition, writeNotePosition,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("保存失败或保存期间继续输入时保留当前编辑视图", async () => {
  let draft = "第一次写入";
  const read = () => draft;
  assert.equal(await saveBeforeNoteViewChange(read, async () => false), false);

  let completeSave;
  const pending = saveBeforeNoteViewChange(read, (value) => {
    assert.equal(value, "第一次写入");
    return new Promise((resolve) => { completeSave = resolve; });
  });
  draft = "保存期间继续写入";
  completeSave(true);
  assert.equal(await pending, false);
  assert.equal(await saveBeforeNoteViewChange(read, async () => true), true);
});

test("源码定位跳过 frontmatter，代码块内部标题保持在同一块", () => {
  const markdown = "---\nkey: test\n---\n\n# 标题\n\n段落\n\n```md\n# 代码内的标题\n```\n\n最后一段";
  assert.deepEqual(sourceBlockOffsets(markdown, true), [
    markdown.indexOf("# 标题"), markdown.indexOf("段落"), markdown.indexOf("```md"), markdown.indexOf("最后一段"),
  ]);
});

test("位置按账号和条目隔离，解锁笔记的位置只保留在内存", () => {
  const position = { block: 2, fraction: 0.25, scrollTop: 320 };
  const normal = notePositionKey("a", "doc", false);
  const sealed = notePositionKey("a", "doc", true);
  writeNotePosition(normal, false, position);
  writeNotePosition(sealed, true, position);
  assert.deepEqual(JSON.parse(sessionStorage.getItem(normal)), position);
  assert.equal(sessionStorage.getItem(sealed), null);
  assert.deepEqual(readNotePosition(sealed, true), position);
  assert.equal(readNotePosition(notePositionKey("b", "doc", false), false), undefined);
});

test("切换源码时以旧布局记录锚点，等待新适配器挂载", async () => {
  const markdown = "---\nkey: test\n---\n\n第一段\n\n第二段\n\n第三段";
  const root = createRoot(document.getElementById("root"));
  let scroller;
  let remember;
  let headerHeight = 48;
  const restores = [];
  function Surface({ view, mountedKind }) {
    const position = useNoteViewPosition("active-account", "source-switch", view, true);
    remember = position.rememberPosition;
    useLayoutEffect(() => {
      scroller = position.scrollerRef.current;
      Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 700 });
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
      scroller.getBoundingClientRect = () => ({ top: 0 });
      position.registerCursor({
        requestedKind: mountedKind,
        kind: mountedKind,
        read: () => ({ start: 6, end: 6 }),
        restore: (start, end) => restores.push([mountedKind, start, end]),
        restoreBlock: (index) => restores.push([mountedKind, index]),
      });
    }, [mountedKind]);
    const editor = mountedKind === "source"
      ? createElement("textarea", { defaultValue: markdown })
      : createElement("div", { className: "ProseMirror" }, ["第一段", "第二段", "第三段"].map((text, index) =>
        createElement("p", { key: text, ref: (node) => {
          if (!node) return;
          node.getBoundingClientRect = () => {
            const top = headerHeight + index * 90 - scroller.scrollTop;
            return { top, bottom: top + 90, height: 90 };
          };
        } }, text)));
    return createElement("div", { ref: position.scrollerRef },
      createElement("div", { className: "mn-editor-host" }, editor));
  }
  try {
    await act(async () => { root.render(createElement(Surface, { view: "wysiwyg", mountedKind: "wysiwyg" })); });
    scroller.scrollTop = 145;
    remember();
    headerHeight -= 90;
    await act(async () => { root.render(createElement(Surface, { view: "source", mountedKind: "wysiwyg" })); });
    assert.deepEqual(restores, []);
    await act(async () => { root.render(createElement(Surface, { view: "source", mountedKind: "source" })); });
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.deepEqual(restores, [["source", markdown.indexOf("第二段"), markdown.indexOf("第二段")]]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("编辑与预览在占位高度变化后对齐同一块，切回编辑恢复原生光标", async () => {
  const rootElement = document.getElementById("root");
  const root = createRoot(rootElement);
  let scroller;
  let restored;
  let current;
  let previewBlockHeight = 65;
  function Surface({ view }) {
    const position = useNoteViewPosition("active-account", "demo", view, true);
    current = position;
    useLayoutEffect(() => {
      scroller = position.scrollerRef.current;
      Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 700 });
      Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
      scroller.getBoundingClientRect = () => ({ top: 0 });
      if (view === "preview") {
        requestAnimationFrame(() => {
          previewBlockHeight = 58;
          scroller.dispatchEvent(new dom.window.Event("scroll"));
        });
      }
      if (view === "wysiwyg") position.registerCursor({
        requestedKind: "wysiwyg",
        kind: "wysiwyg",
        read: () => ({ start: 25, end: 29 }),
        restore: (start, end) => { restored = [start, end]; },
        restoreBlock: () => {},
      });
    }, [view]);
    return createElement("div", { ref: position.scrollerRef },
      createElement("div", { className: view === "preview" ? "" : "mn-editor-host" },
        createElement("div", { className: view === "preview" ? "mn-doc-preview" : "ProseMirror" },
          ["第一段", "第二段", "第三段", "第四段"].map((text, index) => createElement("p", { key: text, ref: (node) => {
            if (!node) return;
            node.getBoundingClientRect = () => {
              const height = view === "preview" ? previewBlockHeight : 90;
              const top = 50 + index * height - position.scrollerRef.current.scrollTop;
              return { top, bottom: top + height, height };
            };
          } }, text)))));
  }
  try {
    await act(async () => { root.render(createElement(Surface, { view: "wysiwyg" })); });
    scroller.scrollTop = 252;
    current.rememberPosition();
    await act(async () => { root.render(createElement(Surface, { view: "preview" })); });
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(Math.round(scroller.scrollTop), 180);
    current.rememberPosition();
    await act(async () => { root.render(createElement(Surface, { view: "wysiwyg" })); });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(Math.round(scroller.scrollTop), 252);
    assert.deepEqual(restored, [25, 29]);
    assert.equal(document.activeElement, document.body);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
