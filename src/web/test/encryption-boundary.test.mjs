import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const bundle = await build({
  stdin: { contents: `
    export { localDb } from './db/localDb';
    export { enableItemEncryption, saveEncryptedContent } from './services/encryptionCommandService';
    export { decryptMarkdown, encryptMarkdown, generateContentKey } from './services/cryptoService';
    export { packEnvelope, unpackEnvelope } from './services/contentShared';
    export { writeRecovery } from './services/recoveryService';
    export { unlockNote, getContentKey, setSessionKey } from './services/keyringService';
  `, resolveDir: srcDir, loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const app = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const USER = "encryption-boundary-user";
const CODE = "ABCD-EFGH-JKMP-QRST-VWXY-2345-6789-ABCD";
const HASH = "a".repeat(64);

async function reset() {
  await Promise.all(app.localDb.tables.map((table) => table.clear()));
}

async function note(markdown = "当前正文") {
  const item = {
    id: "note-1", userId: USER, type: "note", title: "标题", topicId: null, groupId: null,
    tags: [], status: null, attachmentHashes: [], source: "manual", rev: 1, metaRev: 1,
    contentHash: "before", pinned: false, starred: false, createdAt: 1, updatedAt: 1,
    deletedAt: null, content: { scope: "plain", markdown },
  };
  await app.localDb.items.put(item);
  return item;
}

test("encryption rejects references to unencrypted attachments without altering the note", async () => {
  await reset();
  const item = await note();
  await assert.rejects(app.enableItemEncryption(USER, item.id, `![图](attachments/${HASH}--x.png)`, "secret1", CODE), /attachment_encryption_unsupported/);
  assert.deepEqual(await app.localDb.items.get(item.id), item);
  await app.localDb.items.put({ ...item, attachmentHashes: [HASH] });
  await assert.rejects(app.enableItemEncryption(USER, item.id, "引用已从编辑器删除", "secret1", CODE), /attachment_encryption_unsupported/);
  assert.equal(await app.localDb.wraps.count(), 0);
});

test("encryption refuses unsynced plaintext operations without discarding them", async () => {
  await reset();
  const item = await note();
  await app.localDb.outbox.add({ userId: USER, entity: "item", entityId: item.id, payload: { item } });
  await assert.rejects(app.enableItemEncryption(USER, item.id, "当前正文", "secret1", CODE), /encryption_pending_sync/);
  assert.equal((await app.localDb.items.get(item.id)).content.scope, "plain");
  assert.equal(await app.localDb.outbox.count(), 1);
  assert.equal(await app.localDb.wraps.count(), 0);
});

test("encryption seals existing plaintext versions and recovery without losing their contents", async () => {
  await reset();
  const item = await note();
  await app.localDb.versions.add({ itemId: item.id, userId: USER, title: item.title, content: "历史正文", scope: "plain", rev: 1, reason: "autosave", createdAt: 1 });
  await app.localDb.recovery.put({ itemId: item.id, userId: USER, content: "尚未保存的恢复正文", scope: "plain", updatedAt: 1 });
  const result = await app.enableItemEncryption(USER, item.id, "最新正文", "secret1", CODE);
  const version = await app.localDb.versions.where("itemId").equals(item.id).first();
  const recovery = await app.localDb.recovery.get(item.id);
  assert.equal(version.scope, "sealed");
  assert.equal(recovery.scope, "sealed");
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(version.content), result.key), "历史正文");
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(recovery.content), result.key), "尚未保存的恢复正文");
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(result.item.content.ciphertext), result.key), "最新正文");
  await app.writeRecovery(USER, item.id, "迟到的明文恢复快照", "plain");
  assert.deepEqual(await app.localDb.recovery.get(item.id), recovery);
});

test("unlocking an older encrypted note seals its legacy plaintext history and recovery", async () => {
  await reset();
  const item = await note();
  await app.enableItemEncryption(USER, item.id, "正文", "secret1", CODE);
  await app.localDb.versions.add({ itemId: item.id, userId: USER, title: item.title, content: "旧版明文历史", scope: "plain", rev: 1, reason: "autosave", createdAt: 1 });
  await app.localDb.recovery.put({ itemId: item.id, userId: USER, content: "旧版明文恢复", scope: "plain", updatedAt: 1 });
  assert.equal(await app.unlockNote(item.id, "secret1"), "ok");
  const version = await app.localDb.versions.where("itemId").equals(item.id).first();
  const recovery = await app.localDb.recovery.get(item.id);
  const key = app.getContentKey(item.id);
  assert.equal(version.scope, "sealed");
  assert.equal(recovery.scope, "sealed");
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(version.content), key), "旧版明文历史");
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(recovery.content), key), "旧版明文恢复");
});

test("legacy history remains untouched if the stored note does not match the unwrapped key", async () => {
  await reset();
  const item = await note();
  const encrypted = await app.enableItemEncryption(USER, item.id, "正文", "secret1", CODE);
  const foreign = await app.encryptMarkdown("不同密钥的正文", app.generateContentKey());
  await app.localDb.items.put({ ...encrypted.item, content: { scope: "self", ciphertext: app.packEnvelope(foreign.iv, foreign.ciphertext) } });
  await app.localDb.versions.add({ itemId: item.id, userId: USER, title: item.title, content: "须保留的历史", scope: "plain", rev: 1, reason: "autosave", createdAt: 1 });
  await assert.rejects(app.unlockNote(item.id, "secret1"));
  const version = await app.localDb.versions.where("itemId").equals(item.id).first();
  assert.equal(version.scope, "plain");
  assert.equal(version.content, "须保留的历史");
});

test("encrypted note cannot acquire an unencrypted attachment through pasted Markdown", async () => {
  await reset();
  const item = await note();
  const encrypted = await app.enableItemEncryption(USER, item.id, "正文", "secret1", CODE);
  app.setSessionKey(item.id, encrypted.key);
  await assert.rejects(app.saveEncryptedContent(USER, item.id, `![图](attachments/${HASH}--x.png)`), /暂不支持新增附件引用/);
  assert.deepEqual(await app.localDb.items.get(item.id), encrypted.item);
});

test("legacy encrypted notes can retain and remove existing plaintext attachment references", async () => {
  await reset();
  const item = await note();
  const encrypted = await app.enableItemEncryption(USER, item.id, "正文", "secret1", CODE);
  app.setSessionKey(item.id, encrypted.key);
  await app.localDb.items.put({ ...encrypted.item, attachmentHashes: [HASH] });
  const preserved = await app.saveEncryptedContent(USER, item.id, `修改文字 ![旧图](attachments/${HASH}--x.png)`);
  assert.deepEqual(preserved.attachmentHashes, [HASH]);
  const removed = await app.saveEncryptedContent(USER, item.id, "旧图已移除");
  assert.deepEqual(removed.attachmentHashes, []);
});
