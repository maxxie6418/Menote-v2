import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { installRecoveryCodeFixture } from "./recovery-code-fixture.mjs";

const resetServer = installRecoveryCodeFixture();
const recoveryFetch = globalThis.fetch;
const attachments = new Map();
const uploads = [];
const downloads = [];
const SEALED_MIME = "application/vnd.menote.sealed-attachment";
let uploadHook;
globalThis.fetch = async (input, init) => {
  if (!input.startsWith("/api/attachments/")) return recoveryFetch(input, init);
  const hash = input.split("/").at(-1);
  downloads.push(hash);
  assert.equal(init.cache, "no-store");
  const blob = attachments.get(hash);
  return blob ? new Response(blob) : new Response(null, { status: 404 });
};
globalThis.XMLHttpRequest = class {
  upload = {};
  open(method, path) { assert.deepEqual([method, path], ["POST", "/api/attachments"]); }
  setRequestHeader(name, value) { assert.deepEqual([name, value], ["Content-Type", SEALED_MIME]); }
  async send(file) {
    try {
      const hash = await hashBlob(file);
      uploads.push({ file, hash });
      await uploadHook?.();
      attachments.set(hash, file);
      this.status = 200;
      this.responseText = JSON.stringify({ sha256: hash });
    } catch {
      this.status = 507;
      this.responseText = '{"error":"quota"}';
    }
    this.onload();
  }
};

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const bundle = await build({
  stdin: { contents: `
    export { localDb } from './db/localDb';
    export { enableItemEncryption, migrateEncryptedAttachments, saveEncryptedContent } from './services/encryptionCommandService';
    export { decryptMarkdown, encryptMarkdown, generateContentKey } from './services/cryptoService';
    export { packEnvelope, unpackEnvelope } from './services/contentShared';
    export { writeRecovery } from './services/recoveryService';
    export { lockItem, unlockNote, getContentKey, setSessionKey } from './services/keyringService';
    export { openSealedAttachment, sealAttachment } from './services/sealedAttachmentService';
  `, resolveDir: srcDir, loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const app = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const USER = "encryption-boundary-user";
const CODE = "ABCD-EFGH-JKMP-QRST-VWXY-2345-6789-ABCD";
const HASH = "a".repeat(64);

async function reset() {
  resetServer();
  attachments.clear();
  uploads.length = 0;
  downloads.length = 0;
  uploadHook = undefined;
  await Promise.all(app.localDb.tables.map((table) => table.clear()));
}

async function hashBlob(blob) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())).toString("hex");
}

async function attach(text) {
  const blob = new Blob([text], { type: "text/plain" });
  const hash = await hashBlob(blob);
  attachments.set(hash, blob);
  return hash;
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

test("encryption requires attachment conversion confirmation, even for history-only references", async () => {
  await reset();
  const item = await note();
  await assert.rejects(app.enableItemEncryption(USER, item.id, `![图](attachments/${HASH}--x.png)`, "secret1", CODE), /attachment_migration_confirmation_required/);
  assert.deepEqual(await app.localDb.items.get(item.id), item);
  await app.localDb.versions.add({ itemId: item.id, userId: USER, title: item.title, content: `[图](attachments/${HASH}--x.png)`, scope: "plain", rev: 0, reason: "autosave", createdAt: 1 });
  await assert.rejects(app.enableItemEncryption(USER, item.id, "引用已从编辑器删除", "secret1", CODE), /attachment_migration_confirmation_required/);
  assert.equal(await app.localDb.wraps.count(), 0);
  assert.deepEqual(downloads, []);
  assert.deepEqual(uploads, []);
});

test("enabling encryption migrates shared references once while preserving aliases, snapshots and original objects", async () => {
  await reset();
  const hash = await attach("共享文件内容");
  const historyOnly = await attach("仅历史附件内容");
  const markdown = `![图](attachments/${hash}--x.png) [附件](attachments/${hash}--%E5%8E%9F.txt)`;
  const history = `[版本](attachments/${hash}--旧.txt) [仅历史](attachments/${historyOnly}--h.txt)`;
  const recovery = `[恢复](attachments/${hash}--draft.txt)`;
  const item = await note(markdown);
  await app.localDb.versions.add({ itemId: item.id, userId: USER, title: item.title, content: history, scope: "plain", rev: 0, reason: "autosave", createdAt: 1 });
  await app.localDb.recovery.put({ itemId: item.id, userId: USER, content: recovery, scope: "plain", updatedAt: 1 });
  const result = await app.enableItemEncryption(USER, item.id, markdown, "secret1", CODE, { migrateAttachments: true });
  const [{ hash: migrated, file }, { hash: migratedHistory }] = uploads;
  assert.deepEqual(downloads, [hash, historyOnly]);
  assert.equal(file.name, "sealed");
  assert.equal(file.type, SEALED_MIME);
  assert.equal(await (await app.openSealedAttachment(file, result.key)).text(), "共享文件内容");
  assert.notEqual(migrated, hash);
  assert.deepEqual(result.item.attachmentHashes, [migrated]);
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(result.item.content.ciphertext), result.key), markdown.replaceAll(hash, migrated));
  const version = await app.localDb.versions.where("itemId").equals(item.id).first();
  const savedRecovery = await app.localDb.recovery.get(item.id);
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(version.content), result.key), history.replaceAll(hash, migrated).replaceAll(historyOnly, migratedHistory));
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(savedRecovery.content), result.key), recovery.replaceAll(hash, migrated));
  const outbox = await app.localDb.outbox.toArray();
  assert.deepEqual(outbox.map((row) => row.payload.item.attachmentHashes), [[migrated]]);
  assert.ok(attachments.has(hash) && attachments.has(historyOnly));
});

test("missing historical attachments and failed uploads leave encryption inputs unchanged and allow retry", async () => {
  await reset();
  const hash = await attach("当前文件");
  const historicalHash = await attach("历史文件");
  const historicalBlob = attachments.get(historicalHash);
  attachments.delete(historicalHash);
  const item = await note(`[附件](attachments/${hash}--current.txt)`);
  const versionId = await app.localDb.versions.add({ itemId: item.id, userId: USER, title: item.title,
    content: `[旧附件](attachments/${historicalHash}--old.txt)`, scope: "plain", rev: 0, reason: "autosave", createdAt: 1 });
  const version = await app.localDb.versions.get(versionId);
  const convert = () => app.enableItemEncryption(USER, item.id, item.content.markdown, "secret1", CODE, { migrateAttachments: true });
  await assert.rejects(convert(), /attachment_migration_source_unavailable/);
  assert.equal(uploads.length, 1);
  assert.deepEqual(await app.localDb.items.get(item.id), item);
  assert.deepEqual(await app.localDb.versions.get(versionId), version);
  assert.equal(await app.localDb.outbox.count(), 0);
  attachments.set(historicalHash, historicalBlob);
  uploadHook = () => { throw new Error("quota"); };
  await assert.rejects(convert(), /attachment_migration_upload_failed/);
  assert.deepEqual(await app.localDb.items.get(item.id), item);
  assert.deepEqual(await app.localDb.versions.get(versionId), version);
  assert.equal(await app.localDb.wraps.count(), 0);
  uploadHook = undefined;
  assert.equal((await convert()).item.content.scope, "self");
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
  await assert.rejects(app.saveEncryptedContent(USER, item.id, `![图](attachments/${HASH}--x.png)`), /请通过加密笔记的附件入口上传/);
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

async function legacyEncryptedNote(markdown, hashes, key = app.generateContentKey()) {
  const item = await note();
  const envelope = await app.encryptMarkdown(markdown, key);
  const encrypted = { ...item, content: { scope: "self", ciphertext: app.packEnvelope(envelope.iv, envelope.ciphertext) }, attachmentHashes: hashes };
  await app.localDb.items.put(encrypted);
  app.setSessionKey(item.id, key);
  return { encrypted, key };
}

test("converting a legacy encrypted note preserves sealed attachments, updates recovery, and is idempotent", async () => {
  await reset();
  const key = app.generateContentKey();
  const existing = await app.sealAttachment(new Blob(["已有密文"]), key);
  const existingHash = await hashBlob(existing);
  attachments.set(existingHash, existing);
  const oldHash = await attach("旧文件");
  const markdown = `[已有密文](attachments/${existingHash}--sealed.txt) [旧文件](attachments/${oldHash}--legacy.txt)`;
  const { encrypted } = await legacyEncryptedNote(markdown, [existingHash, oldHash], key);
  await app.writeRecovery(USER, encrypted.id, `draft ${markdown}`, "sealed");
  const result = await app.migrateEncryptedAttachments(USER, encrypted);
  assert.equal(uploads.length, 1);
  const replacement = uploads[0].hash;
  assert.deepEqual(result, { count: 1, markdown: markdown.replace(oldHash, replacement) });
  const updated = await app.localDb.items.get(encrypted.id);
  assert.deepEqual(updated.attachmentHashes, [existingHash, replacement]);
  assert.equal(updated.rev, encrypted.rev + 1);
  const recovery = await app.localDb.recovery.get(encrypted.id);
  assert.equal(await app.decryptMarkdown(app.unpackEnvelope(recovery.content), key), `draft ${result.markdown}`);
  assert.deepEqual(await app.migrateEncryptedAttachments(USER, updated), { count: 0, markdown: result.markdown });
  assert.equal(uploads.length, 1);
  assert.equal(await app.localDb.outbox.count(), 1);
  assert.ok(attachments.has(oldHash));
});

test("legacy migrations refuse to replace concurrent snapshots or commit after the session locks", async () => {
  await reset();
  const hash = await attach("旧文件");
  const { encrypted } = await legacyEncryptedNote(`[旧文件](attachments/${hash}--legacy.txt)`, [hash]);
  let concurrentRecovery;
  uploadHook = async () => {
    await app.writeRecovery(USER, encrypted.id, "另一个会话的修改", "sealed");
    concurrentRecovery = await app.localDb.recovery.get(encrypted.id);
  };
  await assert.rejects(app.migrateEncryptedAttachments(USER, encrypted), /encryption_item_changed/);
  assert.deepEqual(await app.localDb.items.get(encrypted.id), encrypted);
  assert.deepEqual(await app.localDb.recovery.get(encrypted.id), concurrentRecovery);
  assert.equal(await app.localDb.outbox.count(), 0);
  uploadHook = () => app.lockItem(encrypted.id);
  await assert.rejects(app.migrateEncryptedAttachments(USER, encrypted), /locked/);
  assert.deepEqual(await app.localDb.items.get(encrypted.id), encrypted);
  assert.equal(await app.localDb.outbox.count(), 0);
});
