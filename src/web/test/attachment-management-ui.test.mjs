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
const fixture = globalThis.attachmentFixture = { rows: [], pages: {}, locallyReferenced: new Set(), deleted: [] };
const bundle = await build({
  stdin: { contents: `export { createElement, act } from 'react'; export { createRoot } from 'react-dom/client';
    export { AttachmentListPanel } from './src/features/attachments/AttachmentListPanel';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  plugins: [{ name: "attachment-fixtures", setup(build) {
    build.onResolve({ filter: /\/(attachmentService|settingsPrefetch|ConfirmDialog)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
    build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => {
      if (args.path.endsWith("ConfirmDialog")) return { contents: "export const confirmDialog = async () => true;", loader: "js" };
      return { contents: args.path.endsWith("attachmentService")
        ? `
          const fixture = globalThis.attachmentFixture;
          export const attachmentUrl = () => '#';
          export const listAttachments = async (cursor) => fixture.pages[cursor] ?? { attachments: fixture.rows };
          export const listAttachmentReferences = async () => ({});
          export const locallyReferencedAttachmentHashes = async () => fixture.locallyReferenced;
          export async function deleteAttachment(hash) {
            fixture.deleted.push(hash);
            fixture.rows = fixture.rows.filter((row) => row.sha256 !== hash);
            return 'deleted';
          }`
        : `export const SETTINGS_CACHE = { attachments: () => 'attachments', attachmentRefs: () => 'refs' }; export const peek = () => null; export const loadShared = async (_key, fn) => fn();`, loader: "js" };
    });
  } }],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { createElement, act, createRoot, AttachmentListPanel } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const buttonWith = (container, text) => [...container.querySelectorAll("button")].find((button) => button.textContent.includes(text));
const cleanupButton = (container) => buttonWith(container, "清理本页到期附件");
const row = (sha256, cleanupEligibleAt) => ({ sha256, mime: "image/png", size: 1, refCount: 0, cleanupEligibleAt });

test("附件管理显示未引用但未到期的附件，等待观察期结束", async () => {
  fixture.rows = [row("a", Date.now() + 100_000)];
  const container = document.getElementById("root");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(AttachmentListPanel, { userId: "test" })); });
  assert.match(container.textContent, /本页 1 个附件/);
  assert.match(container.textContent, /未引用 1 个/);
  assert.match(container.textContent, /可清理 0 个/);
  assert.equal(cleanupButton(container).disabled, true);
  await act(async () => root.unmount());
});

test("批量清理跳过未同步的本机引用，只发送符合条件的附件", async () => {
  fixture.rows = [row("remote-orphan", 1), row("local-ref", 1), row("still-in-window", Date.now() + 100_000)];
  fixture.locallyReferenced = new Set(["local-ref"]);
  const container = document.getElementById("root");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(AttachmentListPanel, { userId: "test" })); });
  assert.equal(cleanupButton(container).disabled, false);
  await act(async () => { cleanupButton(container).click(); });
  assert.deepEqual(fixture.deleted, ["remote-orphan"]);
  assert.match(container.querySelector("[role='status']").textContent, /已清理 1 个，保留 1 个/);
  assert.match(container.textContent, /本页 2 个附件/);
  await act(async () => root.unmount());
});

test("附件管理可翻到下一页及返回上一页", async () => {
  fixture.pages = {
    "": { attachments: [row("first", 1)], nextCursor: "first" },
    "first": { attachments: [row("following", 1)] },
  };
  const container = document.getElementById("root");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(AttachmentListPanel, { userId: "test" })); });
  assert.match(container.textContent, /first…/);
  assert.equal(buttonWith(container, "上一页").disabled, true);
  await act(async () => { buttonWith(container, "下一页").click(); });
  assert.match(container.textContent, /following…/);
  assert.equal(buttonWith(container, "下一页").disabled, true);
  await act(async () => { buttonWith(container, "上一页").click(); });
  assert.match(container.textContent, /first…/);
  await act(async () => root.unmount());
});
