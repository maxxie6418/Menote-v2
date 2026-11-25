import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const bundle = await build({
  stdin: {
    contents: `export { localDb } from "./src/db/localDb";
               export { createNote, saveItemContent, saveItemMeta } from "./src/services/contentService";
               export { obsidianExportMarkdown, effectiveNoteTags } from "./src/lib/noteProperties";
               export { parseFrontmatterData } from "./src/lib/frontmatter";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { localDb, createNote, saveItemContent, saveItemMeta, obsidianExportMarkdown, effectiveNoteTags, parseFrontmatterData } = mod;
const attachmentBundle = await build({
  stdin: {
    contents: `export { uploadAttachment, ATTACHMENT_UPLOAD_TIMEOUT_MS } from "./src/services/attachmentService";
               export { saveEditors } from "./src/services/editorSaveService";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});

const attachmentModule = await import(`data:text/javascript;base64,${Buffer.from(attachmentBundle.outputFiles[0].text).toString("base64")}`);
const USER = "user-a";
const SHA = "a".repeat(64);

test("an attachment still uploading prevents an all-uploaded acknowledgement", async () => {
  const original = globalThis.XMLHttpRequest;
  let request;
  let sent;
  const ready = new Promise((resolve) => { sent = resolve; });
  globalThis.XMLHttpRequest = class {
    upload = {};
    open() {}
    setRequestHeader() {}
    send() { request = this; sent(); }
  };
  try {
    const uploading = attachmentModule.uploadAttachment(USER, { type: "image/png", name: "pending.png", size: 1024 });
    await ready;
    assert.equal(await attachmentModule.saveEditors(USER), false);
    assert.equal(await attachmentModule.saveEditors("another-user"), true);
    request.ontimeout();
    assert.deepEqual(await uploading, { error: "timeout" });
    assert.equal(await attachmentModule.saveEditors(USER), true, "请求结束后解除传输中的阻挡");
  } finally { globalThis.XMLHttpRequest = original; }
});
async function reset() {
  await Promise.all(localDb.tables.map((table) => table.clear()));
}

test("attachment upload times out and returns a retryable error", async () => {
  await reset();
  const original = globalThis.XMLHttpRequest;
  let request;
  globalThis.XMLHttpRequest = class {
    upload = {};
    open() {}
    setRequestHeader() {}
    send() { this.ontimeout?.(); }
    constructor() { request = this; }
  };
  try {
    /* 上传接口后来加了首个参数 userId（账号级附件策略，FR-SYNC-13），
       本用例此前仍按旧签名只传 file，导致 userId 收到对象、读策略时 IndexedDB 抛 DataError。 */
    const result = await attachmentModule.uploadAttachment(USER, { type: "image/png", name: "image.png", size: 1024 });
    assert.equal(request.timeout, 120_000);
    assert.deepEqual(result, { error: "timeout" });
  } finally {
    globalThis.XMLHttpRequest = original;
  }
});

test("saving content backfills the attachment hash list (FR-SYNC-7)", async () => {
  await reset();
  const item = await createNote(USER, { title: "带图笔记" });
  const saved = await saveItemContent(USER, item.id, `正文\n\n![图](attachments/${SHA}--图.png)`);
  // 条目自带附件哈希列表：服务端引用计数与备份收录都以它为准
  assert.deepEqual(saved.attachmentHashes, [SHA]);
  const stored = await localDb.items.get(item.id);
  assert.deepEqual(stored.attachmentHashes, [SHA]);
  // 同步载荷带同一份列表
  const row = await localDb.outbox.orderBy("seq").last();
  assert.deepEqual(row.payload.item.attachmentHashes, [SHA]);
});

test("Obsidian YAML 标签与旧标签合并，源码清空和标题栏新增共用保存链路", async () => {
  await reset();
  const note = await createNote(USER, { title: "YAML 属性" });
  const original = "\uFEFF---\r\ntags: [Vault/Topic]\r\naliases: ['别名'] # 保留\r\ncustom: { count: 3 }\r\n---\r\n\r\n正文\r\n";
  await localDb.items.put({ ...note, tags: ["Legacy", "vault/topic"], content: { scope: "plain", markdown: original } });
  const row = await localDb.items.get(note.id);
  assert.deepEqual(effectiveNoteTags(row), ["Vault/Topic", "Legacy"]);
  const exported = obsidianExportMarkdown(row);
  assert.deepEqual(parseFrontmatterData(exported).tags, ["Vault/Topic", "Legacy"]);
  assert.match(exported, /# 保留\r\n/);
  assert.ok(exported.endsWith("---\r\n\r\n正文\r\n"));

  const changed = await saveItemMeta(USER, note.id, { tags: ["New", "#new"] });
  assert.deepEqual(changed.tags, ["New"]);
  assert.deepEqual(parseFrontmatterData(changed.content.markdown).tags, changed.tags);
  assert.deepEqual(parseFrontmatterData(changed.content.markdown).custom, { count: 3 });
  const operation = await localDb.outbox.orderBy("seq").last();
  assert.equal(operation.noteTagsFromContent, true);
  assert.equal(operation.contentHash, changed.contentHash);

  const invalid = await saveItemContent(USER, note.id, "---\ntags: [\n---\n正文");
  assert.deepEqual(invalid.tags, ["New"]);
  const cleared = await saveItemContent(USER, note.id, "---\ntags: []\n---\n正文");
  assert.deepEqual(cleared.tags, []);
});

test("removing the image from the content clears the hash list", async () => {
  await reset();
  const item = await createNote(USER, { title: "带图笔记" });
  const withImage = await saveItemContent(USER, item.id, `![图](attachments/${SHA}--图.png)`);
  assert.deepEqual(withImage.attachmentHashes, [SHA]);
  const cleared = await saveItemContent(USER, item.id, "正文里已删掉图片");
  assert.deepEqual(cleared.attachmentHashes, []);
});
