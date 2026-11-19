import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement", "Event", "requestAnimationFrame"]) {
  globalThis[key] = key === "requestAnimationFrame" ? dom.window[key].bind(dom.window) : dom.window[key];
}
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.MessageChannel = class {
  port1 = { onmessage: null };
  port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) };
};

const stubs = {
  contentService: [
    "export const createMemo = (...args) => globalThis.testSaveMemo(...args);",
    "export const createNote = () => { throw new Error('unexpected Note save'); };",
    "export const saveItemContent = createNote, saveItemMeta = createNote;",
  ].join("\n"),
  attachmentService: "export const uploadAttachment = (...args) => globalThis.testUploadAttachment(...args);",
  contentHooks: [
    "export const useAllTags = () => [], useLocalSearch = () => [], useRecentItems = () => [];",
    "export const useHomeSnapshot = () => ({ items: [], topics: [] });",
  ].join("\n"),
};
const bundle = await build({
  stdin: {
    contents: [
      'export { createElement, act } from "react";',
      'export { createRoot } from "react-dom/client";',
      'export { MemoCaptureProvider } from "./src/features/memo/useMemoCapture";',
      'export { QuickComposer } from "./src/features/memo/QuickComposer";',
      'export { HomePage } from "./src/app/HomePage";',
      'export { MobileComposer } from "./src/app/MobileComposer";',
    ].join("\n"),
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
  plugins: [{
    name: "memo-capture-stubs",
    setup(builder) {
      builder.onResolve({ filter: /services\/(contentService|attachmentService|contentHooks)$/ }, (args) => {
        if (/(useMemoCapture|QuickComposer|HomePage|MobileComposer)\.tsx$/.test(args.importer)) {
          return { path: args.path.split("/").at(-1), namespace: "capture-stub" };
        }
      });
      builder.onLoad({ filter: /.*/, namespace: "capture-stub" }, (args) => ({ contents: stubs[args.path] }));
    },
  }],
});
const { createElement, act, createRoot, MemoCaptureProvider, QuickComposer, HomePage, MobileComposer } =
  await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64"));

async function withCapture(run) {
  const root = createRoot(document.getElementById("root"));
  const paint = (child, userId = "test-user") => {
    root.render(createElement(MemoCaptureProvider, { key: userId, userId }, child));
  };
  const render = (child, userId) => act(async () => paint(child, userId));
  try { await run(render, paint); }
  finally { await act(async () => root.unmount()); }
}

function edit(node, value) {
  const prototype = node.tagName === "TEXTAREA" ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(node, value);
  node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

function submitShortcut(node, properties = {}) {
  node.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
    key: "Enter", ctrlKey: true, bubbles: true, cancelable: true, ...properties,
  }));
}

const getText = () => document.querySelector("textarea");
const quick = (props = {}) => createElement(QuickComposer, { userId: "test-user", ...props });

test("side capture waits for IME, prevents duplicate save and retains edits entered while saving", async () => {
  await withCapture(async (render) => {
    let firstSave;
    const saved = [];
    globalThis.testSaveMemo = async (...args) => {
      saved.push(args);
      if (saved.length === 1) await new Promise((resolve) => { firstSave = resolve; });
    };
    await render(quick());
    const input = getText();
    await act(async () => {
      input.focus();
      edit(input, "中文第一条");
      input.dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true }));
      submitShortcut(input);
      input.dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true }));
      submitShortcut(input, { isComposing: true });
      submitShortcut(input, { keyCode: 229 });
    });
    assert.equal(saved.length, 0);

    await act(async () => {
      submitShortcut(input);
      submitShortcut(input);
      edit(input, "后续输入");
    });
    assert.deepEqual(saved, [["test-user", "中文第一条", []]]);
    await act(async () => firstSave());
    assert.equal(input.value, "后续输入");
    assert.equal(document.querySelector("[role=status]").textContent, "上一条已保存");

    await act(async () => submitShortcut(input, { ctrlKey: false, metaKey: true }));
    assert.deepEqual(saved[1], ["test-user", "后续输入", []]);
    assert.equal(input.value, "");
    assert.equal(document.activeElement, input);
  });
});

test("home drafts survive leaving and returning to the view and remain scoped to the signed-in account", async () => {
  const home = createElement(HomePage, { userId: "test-user", username: "测试", onImportMarkdown: async () => 0 });
  await withCapture(async (render) => {
    await render(home);
    await act(async () => {
      edit(getText(), "回家后接着写");
      document.querySelector(".mn-home-capture-tool").click();
    });
    await act(async () => edit(document.querySelector("[aria-label='Memo 标签']"), "#工作，团队"));
    await render(quick());
    assert.equal(getText().value, "");
    await render(home);
    assert.equal(getText().value, "回家后接着写");
    await act(async () => document.querySelector(".mn-home-capture-tool").click());
    assert.equal(document.querySelector("[aria-label='Memo 标签']").value, "#工作，团队");
    await render(home, "another-user");
    assert.equal(getText().value, "");
  });
});

test("timeline attachment uses the latest input and partial failures preserve it for submission retry", async () => {
  await withCapture(async (render) => {
    let finishUpload;
    let triedSaving = false;
    globalThis.testUploadAttachment = async (_userId, file) => file.name === "bad.png"
      ? { error: "network" }
      : new Promise((resolve) => { finishUpload = resolve; });
    globalThis.testSaveMemo = async () => {
      if (!triedSaving) { triedSaving = true; throw new Error("local save failed"); }
    };
    await render(quick({ expandedByDefault: true, keepOpenAfterSubmit: true }));
    const input = getText();
    const uploader = document.querySelector("input[type=file]");
    await act(async () => {
      edit(input, "原稿");
      Object.defineProperty(uploader, "files", { value: [
        new dom.window.File(["bad"], "bad.png", { type: "image/png" }),
        new dom.window.File(["good"], "good.png", { type: "image/png" }),
      ] });
      uploader.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    assert.equal(document.querySelector(".mn-composer-save").disabled, true);
    await act(async () => {
      edit(input, "原稿保留\n新输入");
      input.setSelectionRange(4, 4);
      finishUpload({ sha256: "a".repeat(64), name: "good.png" });
    });
    const draft = input.value;
    assert.match(draft, /原稿保留\n\n!\[good\.png\].*\n新输入/s);
    assert.match(document.querySelector("[role=alert]").textContent, /附件上传失败/);
    await act(async () => submitShortcut(input));
    assert.equal(input.value, draft);
    assert.match(document.querySelector("[role=alert]").textContent, /保存失败/);
    await act(async () => submitShortcut(input));
    assert.equal(input.value, "");
    assert.equal(document.activeElement, input);
  });
});

test("mobile Memo stays open on save and closing retains the next draft", async () => {
  const params = {
    userId: "test-user", mode: "memo", title: "", onMode() {}, onTitle() {},
    onSaved() { assert.fail("Memo save left the composer"); },
  };
  await withCapture(async (render, paint) => {
    const saved = [];
    const mobile = createElement(MobileComposer, { ...params, onClose: () => paint(null) });
    globalThis.testSaveMemo = async (...args) => { saved.push(args); };
    await render(mobile);
    const input = getText();
    await act(async () => edit(input, "移动端随记"));
    await act(async () => submitShortcut(input));
    assert.deepEqual(saved, [["test-user", "移动端随记", []]]);
    assert.equal(input.value, "");
    assert.equal(document.activeElement, input);
    assert.equal(document.querySelector("[role=dialog]").getAttribute("aria-label"), "记录 Memo");

    await act(async () => edit(input, "下次继续"));
    await act(async () => document.querySelector(".m-cancel").click());
    assert.equal(getText(), null);
    await render(mobile);
    assert.equal(getText().value, "下次继续");
  });
});
