import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
// 同步周期结束会应用外观偏好（写 CSS 变量与主题标记）：补一个最小 document stub。
globalThis.document = { documentElement: { style: { setProperty() {}, removeProperty() {} }, dataset: {} } };

/** 同一打包实例导出 localDb、同步引擎与 outbox 构造器，避免跨 Dexie 实例事务互锁。 */
const bundle = await build({
  stdin: {
    contents: `export { localDb } from "./src/db/localDb";
               export { runSyncCycle, getSyncPhase, requestSyncNow } from "./src/services/syncEngine";
               export { outboxUpsert, enqueueWrite } from "./src/services/contentShared";
               export { registerEditorSave, notifyEditorChange } from "./src/services/editorSaveService";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { localDb, runSyncCycle, getSyncPhase, requestSyncNow, outboxUpsert, enqueueWrite, registerEditorSave, notifyEditorChange } = mod;

const USER = "user-a";

async function reset() {
  await Promise.all(localDb.tables.map((table) => table.clear()));
  // 跳过外观偏好的首次导入分支（登录时一次性动作，与同步冲突无关）。
  await localDb.meta.put({ key: "appearanceLegacyImported", value: true });
}

/** 条目样本（前端 Item 形状的最小子集）。 */
function item({ id, rev = 1, metaRev = 1, contentHash = "h-1", markdown = "正文", title = "笔记" }) {
  return {
    id, userId: USER, type: "note", topicId: null, groupId: null, title, tags: [], status: null,
    attachmentHashes: [], source: "manual", rev, metaRev, contentHash, pinned: false, starred: false,
    createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 + rev, deletedAt: null,
    content: { scope: "plain", markdown },
  };
}

/** 伪造服务端：push 回固定结果，pull 回固定一页。 */
function stubServer({ pushResults, pullPage }) {
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes("/api/sync/push")) {
      return { ok: true, status: 200, json: async () => ({ results: pushResults }) };
    }
    if (target.includes("/api/sync/pull")) {
      return { ok: true, status: 200, json: async () => pullPage };
    }
    throw new Error(`unexpected fetch: ${target}`);
  };
}

const EMPTY_PULL = { items: [], topics: [], memoComments: [], tombstones: [], settings: [], wraps: [], topicWraps: [], nextCursor: "1", hasMore: false, fullResync: false };

function manualServer({ reject, failPush = false, failPull = false, onPush } = {}) {
  const batches = [];
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("/push")) {
      const operations = JSON.parse(options.body).operations;
      batches.push(operations);
      onPush?.();
      if (failPush) throw new Error("offline");
      return { ok: true, status: 200, json: async () => ({ results: operations.map((row) =>
        row.entityId === reject
          ? { operationId: row.operationId, result: "rejected", code: "invalid_payload" }
          : { operationId: row.operationId, result: "applied", rev: 1, metaRev: 1 }) }) };
    }
    if (failPull) throw new Error("offline");
    return { ok: true, status: 200, json: async () => EMPTY_PULL };
  };
  return batches;
}

async function queueItem(id, overrides = {}) {
  const note = item({ id });
  await localDb.items.put(note);
  await localDb.outbox.add({ ...outboxUpsert(note, 0, 0, "h-1"), ...overrides });
}

test("manual upload saves current editor first and drains every batch for this account", async () => {
  await reset();
  for (let i = 0; i < 22; i++) await queueItem(`manual-${i}`);
  await queueItem("other-account", { userId: "user-b" });
  const off = registerEditorSave(USER, async () => {
    await queueItem("just-finished");
    return true;
  });
  const batches = manualServer();
  try {
    assert.equal(await requestSyncNow(USER), true);
    assert.deepEqual(batches.map((batch) => batch.length), [10, 10, 3]);
    assert.ok(batches.flat().some((row) => row.entityId === "just-finished"));
    assert.equal(await localDb.outbox.where("userId").equals(USER).count(), 0);
    assert.equal(await localDb.outbox.where("userId").equals("user-b").count(), 1);
  } finally { off(); }
});

test("manual upload stops when local saving fails", async () => {
  await reset();
  await queueItem("keep-local");
  const off = registerEditorSave(USER, async () => false);
  const batches = manualServer();
  try {
    assert.equal(await requestSyncNow(USER), false);
    assert.equal(batches.length, 0);
    assert.equal(await localDb.outbox.count(), 1);
  } finally { off(); }
});

test("manual upload retries temporary errors immediately but leaves permanent rejections", async () => {
  await reset();
  await queueItem("retry-network", { lastError: "network", nextRetryAt: Date.now() + 60_000 });
  await queueItem("permanent", { lastError: "rejected:invalid_payload", nextRetryAt: Number.MAX_SAFE_INTEGER });
  const batches = manualServer();
  assert.equal(await requestSyncNow(USER), false);
  assert.deepEqual(batches.flat().map((row) => row.entityId), ["retry-network"]);
  assert.equal((await localDb.outbox.toArray())[0].entityId, "permanent");
});

test("manual upload never reports success for a network failure, and the next click retries", async () => {
  await reset();
  await queueItem("retry");
  const failed = manualServer({ failPush: true });
  assert.equal(await requestSyncNow(USER), false);
  assert.equal(failed.length, 1, "一次点击只提前重试一次，不循环重发失败请求");
  assert.equal(await localDb.outbox.count(), 1);
  manualServer();
  assert.equal(await requestSyncNow(USER), true);
  assert.equal(await localDb.outbox.count(), 0);
});

test("manual upload never reports success when the server rejects an operation or pull fails", async () => {
  await reset();
  await queueItem("reject-me");
  manualServer({ reject: "reject-me" });
  assert.equal(await requestSyncNow(USER), false);
  assert.equal(await localDb.outbox.count(), 1);
  await reset();
  manualServer({ failPull: true });
  assert.equal(await requestSyncNow(USER), false);
});

test("editing while an upload runs invalidates the all-uploaded result", async () => {
  await reset();
  await queueItem("editing");
  manualServer({ onPush: notifyEditorChange });
  assert.equal(await requestSyncNow(USER), false);
});

test("a full batch of blank drafts does not hide subsequent real changes", async () => {
  await reset();
  for (let i = 0; i < 10; i++) {
    const blank = item({ id: `blank-${i}`, markdown: "", title: "无标题" });
    await localDb.items.put(blank);
    await localDb.outbox.add(outboxUpsert(blank, 0, 0, "h-1"));
  }
  await queueItem("real-note");
  const batches = manualServer();
  assert.equal(await requestSyncNow(USER), true);
  assert.deepEqual(batches.flat().map((row) => row.entityId), ["real-note"]);
});

test("manual upload waits for already queued content writes", async () => {
  await reset();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const write = enqueueWrite(async () => { await gate; await queueItem("in-flight-save"); });
  const batches = manualServer();
  const sync = requestSyncNow(USER);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(batches.length, 0);
  release();
  await write;
  assert.equal(await sync, true);
  assert.equal(batches[0][0].entityId, "in-flight-save");
});

test("pull never rolls back an item that still has pending uploads", async () => {
  await reset();
  const local = item({ id: "i1", rev: 3, contentHash: "h-local", markdown: "本地新稿" });
  await localDb.items.put(local);
  await localDb.outbox.add(outboxUpsert(local, 2, 1, "h-local"));
  stubServer({
    pushResults: [{ operationId: "op-1", result: "applied", rev: 3, metaRev: 1 }],
    pullPage: { ...EMPTY_PULL, items: [item({ id: "i1", rev: 2, contentHash: "h-server", markdown: "服务端旧稿" })] },
  });
  await runSyncCycle(USER);
  assert.equal(getSyncPhase(), "idle");
  // 待推条目不被服务端旧版本回写：否则正文与版本号一起退回去，下一轮推送必撞前置条件。
  const stored = await localDb.items.get("i1");
  assert.equal(stored.content.markdown, "本地新稿");
  assert.equal(stored.rev, 3);
});

test("content conflict leaves one synced conflict copy and lands the item on the server version", async () => {
  await reset();
  const local = item({ id: "i1", rev: 3, contentHash: "h-local", markdown: "本地新稿" });
  await localDb.items.put(local);
  const row = outboxUpsert(local, 2, 1, "h-local");
  await localDb.outbox.add(row);
  stubServer({
    pushResults: [{ operationId: row.operationId, result: "conflict", detail: { rev: 2, metaRev: 1, contentHash: "h-server" } }],
    pullPage: { ...EMPTY_PULL, items: [item({ id: "i1", rev: 2, contentHash: "h-server", markdown: "服务端旧稿" })] },
  });
  await runSyncCycle(USER);
  assert.equal(getSyncPhase(), "idle");
  const rows = await localDb.items.toArray();
  const copy = rows.find((entry) => entry.title.includes("冲突副本"));
  assert.ok(copy, "应另存冲突副本");
  assert.equal(copy.content.markdown, "本地新稿");
  // 副本记住它顶掉了哪一条目（G2 §5-2：记录与原条目关联）
  assert.equal(copy.conflictOf, "i1");
  // 冲突副本必须入队上传：只落本地的话，全量重同步或换设备就会清掉用户仅存的那份正文。
  const queued = await localDb.outbox.toArray();
  assert.equal(queued.length, 1);
  assert.equal(queued[0].entityId, copy.id);
  // 原条目采纳服务端版本，版本号也落到服务端当前值（否则下次保存又撞同一条前置条件）。
  const original = await localDb.items.get("i1");
  assert.equal(original.content.markdown, "服务端旧稿");
  assert.equal(original.rev, 2);
});

test("two conflicting saves in one batch leave a single conflict copy", async () => {
  await reset();
  const local = item({ id: "i1", rev: 4, contentHash: "h-local", markdown: "本地新稿" });
  await localDb.items.put(local);
  const first = outboxUpsert(local, 2, 1, "h-local");
  const second = outboxUpsert(local, 3, 1, "h-local");
  await localDb.outbox.add(first);
  await localDb.outbox.add(second);
  stubServer({
    pushResults: [
      { operationId: first.operationId, result: "conflict", detail: { rev: 2, metaRev: 1, contentHash: "h-server" } },
      { operationId: second.operationId, result: "conflict", detail: { rev: 2, metaRev: 1, contentHash: "h-server" } },
    ],
    pullPage: EMPTY_PULL,
  });
  await runSyncCycle(USER);
  assert.equal(getSyncPhase(), "idle");
  const copies = (await localDb.items.toArray()).filter((entry) => entry.title.includes("冲突副本"));
  assert.equal(copies.length, 1);
});

test("encrypted conflict keeps a copy with its key wraps instead of dropping the edit", async () => {
  await reset();
  const local = {
    ...item({ id: "enc-1", rev: 3, contentHash: "enc-local" }),
    content: { scope: "self", ciphertext: "iv:cipher" },
  };
  await localDb.items.put(local);
  await localDb.wraps.put({ itemId: "enc-1", wraps: [{ wrapper: "password", kdfSalt: "s", kdfIterations: 1, iv: "i", ciphertext: "c", generation: 1 }] });
  const row = outboxUpsert(local, 2, 1, "enc-local");
  await localDb.outbox.add(row);
  stubServer({
    pushResults: [{ operationId: row.operationId, result: "conflict", detail: { rev: 2, metaRev: 1, contentHash: "enc-server" } }],
    pullPage: EMPTY_PULL,
  });
  await runSyncCycle(USER);
  assert.equal(getSyncPhase(), "idle");
  const copies = (await localDb.items.toArray()).filter((entry) => entry.title.includes("冲突副本"));
  assert.equal(copies.length, 1);
  assert.equal(copies[0].content.ciphertext, "iv:cipher");
  // 密钥包装块随副本走：换设备后这份稿子仍能解开。
  const copyWraps = await localDb.wraps.get(copies[0].id);
  assert.equal(copyWraps.wraps.length, 1);
});
