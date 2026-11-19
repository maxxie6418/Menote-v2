import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

// 一起打包，使恢复、密钥环和写队列使用同一个实例。
const bundle = await build({
  stdin: {
    contents: `export { localDb } from "./src/db/localDb";
      export { createNote } from "./src/services/contentService";
      export { restoreVersion } from "./src/services/versionService";
      export { setSessionKey, lockItem } from "./src/services/keyringService";
      export { generateContentKey, encryptMarkdown, decryptMarkdown } from "./src/services/cryptoService";
      export { enqueueWrite, unpackEnvelope } from "./src/services/contentShared";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { localDb, createNote, restoreVersion, setSessionKey, lockItem,
  generateContentKey, encryptMarkdown, decryptMarkdown, enqueueWrite, unpackEnvelope } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const userId = "version-user";
const oldHash = "a".repeat(64);
const currentHash = "b".repeat(64);
const oldText = `旧正文 ![图](attachments/${oldHash}--old.png)`;
const currentText = `当前稿 ![图](attachments/${currentHash}--current.png)`;
const sealed = async (text, key) => {
  const result = await encryptMarkdown(text, key);
  return `${result.iv}:${result.ciphertext}`;
};

async function seed(scope = "self") {
  await Promise.all(localDb.tables.map((table) => table.clear()));
  const key = generateContentKey();
  const note = await createNote(userId, { title: "密文历史" });
  const current = { ...note, rev: 4, attachmentHashes: [currentHash],
    content: { scope, ciphertext: await sealed(currentText, key) } };
  await localDb.items.put(current);
  const versionId = await localDb.versions.add({ itemId: note.id, userId, title: note.title,
    content: await sealed(oldText, key), scope: "sealed", rev: 2, reason: "autosave", createdAt: Date.now() });
  setSessionKey(note.id, key);
  return { key, current, versionId };
}

for (const scope of ["self", "private_space"]) {
  test(`restore ${scope} history decrypts and re-encrypts actual text and attachment references`, async () => {
    const { key, current, versionId } = await seed(scope);
    const result = await restoreVersion(userId, current.id, versionId);
    assert.equal(await decryptMarkdown(unpackEnvelope(result.content.ciphertext), key), oldText);
    assert.equal(result.content.scope, scope);
    assert.deepEqual(result.attachmentHashes, [oldHash]);
    assert.equal(result.rev, current.rev + 1);
    const versions = await localDb.versions.where("itemId").equals(current.id).toArray();
    const snapshot = versions.find((row) => row.reason === "restore");
    assert.equal(snapshot.scope, "sealed");
    assert.equal(await decryptMarkdown(unpackEnvelope(snapshot.content), key), currentText);
    const outbox = await localDb.outbox.orderBy("seq").toArray();
    assert.equal(outbox.at(-1).baseRev, current.rev);
    assert.deepEqual(outbox.at(-1).payload.item.attachmentHashes, [oldHash]);
    await lockItem(current.id);
  });
}

test("locked or invalid history restore leaves current item, history and outbox unchanged", async () => {
  const { current, versionId } = await seed();
  const beforeVersions = await localDb.versions.toArray();
  const beforeOutbox = await localDb.outbox.toArray();
  await lockItem(current.id);
  await assert.rejects(restoreVersion(userId, current.id, versionId), /locked/);
  setSessionKey(current.id, generateContentKey());
  await assert.rejects(restoreVersion(userId, current.id, versionId));
  assert.deepEqual(await localDb.items.get(current.id), current);
  assert.deepEqual(await localDb.versions.toArray(), beforeVersions);
  assert.deepEqual(await localDb.outbox.toArray(), beforeOutbox);
  await lockItem(current.id);
});

test("restore reads and archives the latest queued draft", async () => {
  const { key, current, versionId } = await seed();
  const newerText = "队列中的最新稿";
  const newerSealed = await sealed(newerText, key);
  const earlierWrite = enqueueWrite(async () => {
    await localDb.items.put({ ...current, rev: 5, content: { scope: "self", ciphertext: newerSealed } });
  });
  const restoring = restoreVersion(userId, current.id, versionId);
  await earlierWrite;
  const restored = await restoring;
  assert.equal(restored.rev, 6);
  const archived = (await localDb.versions.toArray()).find((row) => row.reason === "restore");
  assert.equal(await decryptMarkdown(unpackEnvelope(archived.content), key), newerText);
  assert.equal((await localDb.outbox.orderBy("seq").last()).baseRev, 5);
  await lockItem(current.id);
});

test("restore rejects if another tab modifies the item while history is decrypting", async () => {
  const { current, versionId } = await seed();
  const beforeVersions = await localDb.versions.toArray();
  const beforeOutbox = await localDb.outbox.toArray();
  const decrypt = crypto.subtle.decrypt;
  const changed = { ...current, metaRev: current.metaRev + 1, title: "另一标签页的修改" };
  crypto.subtle.decrypt = async function (...args) {
    const result = await decrypt.apply(this, args);
    await localDb.items.put(changed);
    return result;
  };
  try {
    await assert.rejects(restoreVersion(userId, current.id, versionId), /version_restore_changed/);
  } finally {
    crypto.subtle.decrypt = decrypt;
    await lockItem(current.id);
  }
  assert.deepEqual(await localDb.items.get(current.id), changed);
  assert.deepEqual(await localDb.versions.toArray(), beforeVersions);
  assert.deepEqual(await localDb.outbox.toArray(), beforeOutbox);
});
