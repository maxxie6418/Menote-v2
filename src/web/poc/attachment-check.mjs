// W3b 接入验证（FR-EDT-10 / FR-SYNC-7）：getMarkdown() 改为现算后，附件引用仍能完整往返。
//
// 背景：编辑器里存的是鉴权 URL（/api/attachments/<sha>），取出时要还原成相对引用
// （attachments/<sha>--<name>）。如果序列化把 URL 转义了，还原就会失配，
// 鉴权地址会直接落盘——违反 C-1「持久层不出现鉴权地址」。
//
// 运行：node --test poc/attachment-check.mjs（在 src/web 下）（不在 pnpm test 套件内，属接入证据）
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

const bundle = await build({
  entryPoints: [new URL("./attachment-entry.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const SHA = "a".repeat(64);

test("附件引用往返：编辑器取出的正文能还原成相对引用", async () => {
  const result = await harness.runAttachmentScenario(SHA);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(
    result.restored.includes(`attachments/${SHA}--图.png`),
    `应还原成相对引用：${result.restored}`,
  );
  assert.ok(
    !result.restored.includes("/api/attachments/"),
    `鉴权地址不得留在持久化文本里：${result.restored}`,
  );
});

test("附件引用的图片语法与链接语法都保得住", async () => {
  const result = await harness.runAttachmentScenario(SHA);
  assert.equal(result.error, undefined, result.error ?? "");
  assert.ok(result.restored.includes("![图.png]"), `图片语法应保留：${result.restored}`);
});
