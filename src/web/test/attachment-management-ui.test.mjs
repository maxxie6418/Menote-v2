import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<div id='root'></div>", { url: "https://menote.test" });
for (const key of ["window", "document", "HTMLElement", "Event"]) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.MessageChannel = class { port1 = { onmessage: null }; port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0) } };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({
  stdin: { contents: `export { createElement, act } from 'react'; export { createRoot } from 'react-dom/client';
    export { AttachmentListPanel } from './src/features/attachments/AttachmentListPanel';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  plugins: [{ name: "attachment-fixtures", setup(build) {
    build.onResolve({ filter: /\/services\/(attachmentService|settingsPrefetch)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: args.path.endsWith("attachmentService")
      ? `export const attachmentUrl = () => '#'; export const listAttachments = async () => [{sha256:'a',mime:'image/png',size:1,refCount:0}]; export const listAttachmentReferences = async () => ({});`
      : `export const SETTINGS_CACHE = { attachments: () => 'attachments', attachmentRefs: () => 'refs' }; export const peek = () => null; export const loadShared = async (_key, fn) => fn();`, loader: "js" }));
  } }],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createElement, act, createRoot, AttachmentListPanel } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("附件管理载入后显示统计并停用清理，不因未引用附件崩溃", async () => {
  const container = document.getElementById("root");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(AttachmentListPanel, { userId: "test" })); });
  assert.match(container.textContent, /共 1 个附件/);
  assert.match(container.textContent, /未引用 1 个/);
  assert.match(container.textContent, /自动清理和手动删除暂不可用/);
  assert.equal([...container.querySelectorAll("button")].find((button) => button.textContent.includes("一键清理")).disabled, true);
  await act(async () => root.unmount());
});
