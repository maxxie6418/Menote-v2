import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/contentService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const content = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const dbBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/db/localDb.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const dbModule = await import(`data:text/javascript;base64,${Buffer.from(dbBundle.outputFiles[0].text).toString("base64")}`);

const USER = "user-a";

/** fake-indexeddb 在同一进程内跨用例持久，先清空再跑。 */
async function resetLocalDb() {
  await Promise.all(dbModule.localDb.tables.map((table) => table.clear()));
}

async function outboxRows() {
  return dbModule.localDb.outbox.orderBy("seq").toArray();
}

test("createNote writes the local row and enqueues one upsert with baseRev 0", async () => {
  await resetLocalDb();
  const note = await content.createNote(USER, { title: "  会议记录  " });
  assert.equal(note.title, "会议记录");
  assert.equal(note.rev, 1);
  assert.equal(note.topicId, null);
  assert.equal(note.content.markdown, "");
  const rows = await outboxRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "upsert");
  assert.equal(rows[0].baseRev, 0);
  assert.equal(rows[0].baseMetaRev, 0);
  assert.ok(rows[0].contentHash);
  assert.equal(rows[0].payload.item.id, note.id);
});

test("saveItemContent bumps rev and chains the outbox baseRev for conflict detection", async () => {
  await resetLocalDb();
  const note = await content.createNote(USER);
  const saved = await content.saveItemContent(USER, note.id, "# 正文\n第一段。");
  assert.equal(saved.rev, 2);
  assert.equal(saved.content.markdown, "# 正文\n第一段。");
  const rows = await outboxRows();
  assert.equal(rows.length, 2);
  assert.equal(rows[1].baseRev, 1);
  const expectedHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("# 正文\n第一段。"));
  const hex = Array.from(new Uint8Array(expectedHash), (b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(rows[1].contentHash, hex);
  const savedAgain = await content.saveItemContent(USER, note.id, "# 正文\n第一段。");
  assert.equal(savedAgain.rev, 2, "same content is a no-op");
  assert.equal((await outboxRows()).length, 2);
});

test("topics subtree aggregation and inbox/drafts sections", async () => {
  await resetLocalDb();
  const topic = await content.createTopic(USER, "工作");
  const group = await content.createTopic(USER, "项目A", topic.id);
  assert.equal(group.depth, 1);
  await assert.rejects(content.createTopic(USER, "错", group.id), /分组只能挂在主题下/);
  const filed = await content.createNote(USER, { topicId: group.id });
  const draft = await content.createNote(USER);
  const collected = await content.createNote(USER, { source: "agent" });
  const inTopic = await content.queries.notesInTopic(USER, topic.id);
  assert.deepEqual(inTopic.map((row) => row.id), [filed.id], "穿透聚合含子分组直属笔记");
  assert.deepEqual((await content.queries.drafts(USER)).map((row) => row.id), [draft.id]);
  assert.deepEqual((await content.queries.inbox(USER)).map((row) => row.id), [collected.id]);
  const renamed = await content.renameTopic(USER, topic.id, "工作（改名）");
  assert.equal(renamed.name, "工作（改名）");
  await content.softDeleteTopic(USER, topic.id);
  assert.equal((await content.queries.topics(USER)).find((row) => row.id === topic.id).deletedAt !== null, true);
});

test("memo commands keep memos out of note sections; meta save bumps metaRev", async () => {
  await resetLocalDb();
  const memo = await content.createMemo(USER, "今天买咖啡", ["生活"]);
  const tags = await content.saveItemMeta(USER, memo.id, { status: "done" });
  assert.equal(tags.metaRev, 2);
  assert.equal(tags.status, "done");
  assert.deepEqual(await content.queries.memos(USER).then((rows) => rows.map((row) => row.id)), [memo.id]);
  assert.equal((await content.queries.drafts(USER)).length, 0);
  await assert.rejects(content.saveItemMeta(USER, memo.id, { groupId: "g1" }), /同时指定主题/);
});

test("soft delete marks the row and enqueues a delete tombstone", async () => {
  await resetLocalDb();
  const note = await content.createNote(USER);
  await content.softDeleteItem(USER, note.id);
  const trashed = await content.queries.trashed(USER);
  assert.equal(trashed.some((row) => row.id === note.id), true);
  const rows = await outboxRows();
  const last = rows[rows.length - 1];
  assert.equal(last.action, "delete");
  assert.equal(last.baseRev, 1);
});

test("local data persists across reconnection (刷新不丢)", async () => {
  await resetLocalDb();
  const note = await content.createNote(USER, { title: "持久化" });
  await content.saveItemContent(USER, note.id, "内容。");
  const fresh = await import(`data:text/javascript;base64,${Buffer.from(dbBundle.outputFiles[0].text).toString("base64")}`);
  const row = await fresh.localDb.items.get(note.id);
  assert.equal(row.title, "持久化");
  assert.equal(row.content.markdown, "内容。");
  assert.equal(row.rev, 2);
});
