import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

// 各实例模拟不同标签页：JS 队列和密钥环独立，但共享 IndexedDB 和同源 Web Locks。
const bundle = await build({
  stdin: {
    contents: `export { localDb } from './src/db/localDb';
      export { enableItemEncryption } from './src/services/encryptionCommandService';
      export { setupPrivateSpace } from './src/services/privateSpaceService';
      export { recoveryCodeExists } from './src/services/recoveryCodeService';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const importTab = async (name) => import(`data:text/javascript;base64,${Buffer.from(`${bundle.outputFiles[0].text}\n// ${name}`).toString("base64")}`);
const firstTab = await importTab("first-tab");
const secondTab = await importTab("second-tab");
const lockQueues = new Map();
const locks = {
  request(name, callback) {
    const previous = lockQueues.get(name) ?? Promise.resolve();
    const next = previous.then(() => callback({ name, mode: "exclusive" }));
    lockQueues.set(name, next.catch(() => {}));
    return next;
  },
};
Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });

const userId = "recovery-lock-user";
const codeA = "AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA";
const codeB = "BBBB-BBBB-BBBB-BBBB-BBBB-BBBB-BBBB-BBBB";
async function reset() {
  await Promise.all(firstTab.localDb.tables.map((table) => table.clear()));
}
async function note(id) {
  const item = { id, userId, type: "note", title: id, topicId: null, groupId: null,
    tags: [], status: null, attachmentHashes: [], source: "manual", rev: 1, metaRev: 1,
    contentHash: "before", pinned: false, starred: false, createdAt: 1, updatedAt: 1,
    deletedAt: null, content: { scope: "plain", markdown: "正文" } };
  await firstTab.localDb.items.put(item);
  return item;
}

test("a private space and note created in separate tabs cannot use different first recovery codes", async () => {
  await reset();
  const item = await note("note-space-race");
  const [space, encryption] = await Promise.allSettled([
    firstTab.setupPrivateSpace(userId, "1234", codeA),
    secondTab.enableItemEncryption(userId, item.id, "正文", "secret1", codeB),
  ]);
  assert.equal(space.status, "fulfilled");
  assert.equal(encryption.status, "rejected");
  assert.match(encryption.reason.message, /recovery_code_mismatch/);
  assert.equal((await firstTab.localDb.items.get(item.id)).content.scope, "plain");
  assert.equal(await firstTab.localDb.topicWraps.count(), 1);
  assert.equal(await firstTab.localDb.wraps.count(), 0);
});

test("two notes in separate tabs serialize recovery-code check and commit", async () => {
  await reset();
  const one = await note("note-one");
  const two = await note("note-two");
  const [first, second] = await Promise.allSettled([
    firstTab.enableItemEncryption(userId, one.id, "正文", "secret1", codeA),
    secondTab.enableItemEncryption(userId, two.id, "正文", "secret1", codeB),
  ]);
  assert.equal(first.status, "fulfilled");
  assert.equal(second.status, "rejected");
  assert.match(second.reason.message, /recovery_code_mismatch/);
  assert.equal((await firstTab.localDb.items.get(one.id)).content.scope, "self");
  assert.equal((await firstTab.localDb.items.get(two.id)).content.scope, "plain");
  assert.equal(await firstTab.localDb.wraps.count(), 1);
});

test("concurrent setup with the same recovery code proceeds after the first operation commits", async () => {
  await reset();
  const item = await note("note-shared-code");
  const [encrypted, space] = await Promise.all([
    firstTab.enableItemEncryption(userId, item.id, "正文", "secret1", codeA),
    secondTab.setupPrivateSpace(userId, "1234", codeA),
  ]);
  assert.equal(encrypted.item.content.scope, "self");
  assert.equal(space.isEncSpace, true);
  assert.equal(await firstTab.localDb.wraps.count(), 1);
  assert.equal(await firstTab.localDb.topicWraps.count(), 1);
});

test("without Web Locks, encryption and private space setup both fail before changing data", async () => {
  await reset();
  const item = await note("note-unsupported");
  Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
  try {
    await assert.rejects(firstTab.enableItemEncryption(userId, item.id, "正文", "secret1", codeA), /recovery_lock_unavailable/);
    await assert.rejects(secondTab.setupPrivateSpace(userId, "1234", codeA), /recovery_lock_unavailable/);
    assert.deepEqual(await firstTab.localDb.items.get(item.id), item);
    assert.equal(await firstTab.localDb.wraps.count(), 0);
    assert.equal(await firstTab.localDb.topicWraps.count(), 0);
    assert.equal(await firstTab.localDb.topics.count(), 0);
  } finally {
    Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
  }
});
