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
               export { createNote, saveItemContent } from "./src/services/contentService";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { localDb, createNote, saveItemContent } = mod;
const attachmentBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/attachmentService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const attachmentModule = await import(`data:text/javascript;base64,${Buffer.from(attachmentBundle.outputFiles[0].text).toString("base64")}`);

const USER = "user-a";
const SHA = "a".repeat(64);

async function reset() {
  await Promise.all(localDb.tables.map((table) => table.clear()));
}

test("attachment upload times out and returns a retryable error", async () => {
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
    // 0.2.44 起上传前读附件策略，签名带 userId；缺失会在策略读取处抛 Dexie DataError。
    const result = await attachmentModule.uploadAttachment(USER, { type: "image/png", name: "image.png" });
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

test("removing the image from the content clears the hash list", async () => {
  await reset();
  const item = await createNote(USER, { title: "带图笔记" });
  const withImage = await saveItemContent(USER, item.id, `![图](attachments/${SHA}--图.png)`);
  assert.deepEqual(withImage.attachmentHashes, [SHA]);
  const cleared = await saveItemContent(USER, item.id, "正文里已删掉图片");
  assert.deepEqual(cleared.attachmentHashes, []);
});
