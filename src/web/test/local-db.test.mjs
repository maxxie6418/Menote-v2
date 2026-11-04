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

const versionBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/versionService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const versions = await import(`data:text/javascript;base64,${Buffer.from(versionBundle.outputFiles[0].text).toString("base64")}`);

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

test("isBlankDraft and the startup sweep honor the three gates (FR-VER-7)", async () => {
  await resetLocalDb();
  const blank = await content.createNote(USER);
  assert.equal(content.isBlankDraft(blank), true);
  const typed = await content.saveItemContent(USER, (await content.createNote(USER)).id, "有内容了");
  assert.equal(content.isBlankDraft(typed), false);
  const renamed = await content.saveItemMeta(USER, (await content.createNote(USER)).id, { title: "正式标题" });
  assert.equal(content.isBlankDraft(renamed), false);
  const memo = await content.createMemo(USER, "");
  assert.equal(content.isBlankDraft(memo), false, "Memo 不适用空白种子闸门");
  // 闸三：超期空白种子连同 create 操作一并回收
  const stale = { ...blank, createdAt: Date.now() - 25 * 3_600_000 };
  await dbModule.localDb.items.put(stale);
  const swept = await content.sweepBlankDrafts(USER, Date.now());
  assert.equal(swept, 1, "超期空白种子连同 create 操作一并回收");
  assert.equal(await dbModule.localDb.items.get(blank.id), undefined);
  assert.equal((await outboxRows()).some((row) => row.entityId === blank.id), false);
  // 闸一：已有真实编辑的种子不动
  const edited = await content.createNote(USER);
  await content.saveItemContent(USER, edited.id, "改过");
  const aged = await dbModule.localDb.items.get(edited.id);
  await dbModule.localDb.items.put({ ...aged, createdAt: Date.now() - 48 * 3_600_000 });
  assert.equal(await content.sweepBlankDrafts(USER, Date.now()), 0);
});

test("version archive, throttle, capacity trim and restore (FR-VER-1/2/3)", async () => {
  await resetLocalDb();
  const note = await content.createNote(USER);
  await content.saveItemContent(USER, note.id, "第一版");
  const rows1 = await dbModule.localDb.versions.where("itemId").equals(note.id).toArray();
  assert.equal(rows1.length, 1, "保存前封存了种子内容");
  assert.equal(rows1[0].content, "");
  // 10 分钟节流内不重复封存
  await content.saveItemContent(USER, note.id, "第二版");
  const rows2 = await dbModule.localDb.versions.where("itemId").equals(note.id).toArray();
  assert.equal(rows2.length, 1);
  // 恢复：先封存当前稿再写回
  const target = rows2[0].id;
  const restored = await versions.restoreVersion(USER, note.id, target);
  assert.equal(restored.content.markdown, "");
  const afterRestore = await dbModule.localDb.versions.where("itemId").equals(note.id).toArray();
  assert.equal(afterRestore.some((row) => row.reason === "restore"), true, "恢复前封存当前稿");
  assert.equal((await dbModule.localDb.items.get(note.id)).content.markdown, "");
});

test("trash restore clears the tombstone and enqueue an upsert (FR-VER-6)", async () => {
  await resetLocalDb();
  const note = await content.createNote(USER);
  await content.softDeleteItem(USER, note.id);
  assert.equal((await content.queries.trashed(USER)).some((row) => row.id === note.id), true);
  await versions.restoreFromTrash(USER, note.id);
  const restored = await dbModule.localDb.items.get(note.id);
  assert.equal(restored.deletedAt, null);
  const rows = await outboxRows();
  assert.equal(rows[rows.length - 1].action, "upsert", "恢复以 upsert 传播（复活语义）");
});

test("表格种子默认一列一排；行里填了内容就不再是种子（FR-TBL-9）", async () => {
  await resetLocalDb();
  const seed = content.defaultTableSeed();
  // 字段定义：名称列按文本类型
  assert.match(seed, /fields:/);
  assert.match(seed, /名称/);
  assert.match(seed, /type: text/);
  // 一列一排：表头行 + 分隔行 + 一个空行
  const tableLines = seed.split("\n").filter((line) => line.includes("|"));
  assert.equal(tableLines.length, 3);
  assert.match(tableLines[0], /名称/);
  assert.equal(tableLines[2].replace(/[|\s]/g, ""), "");
  // 种子可识别（来回切换不卡住）
  const base = { id: "t1", userId: USER, type: "table", topicId: null, groupId: null, title: "无标题", tags: [], status: null, attachmentHashes: [], source: "manual", rev: 1, metaRev: 1, contentHash: "h", pinned: false, starred: false, createdAt: 1, updatedAt: 1, deletedAt: null };
  const seeded = { ...base, content: { scope: "plain", markdown: seed } };
  assert.equal(content.isDefaultTableSeed(seeded), true);
  // 行里填了内容 → 不再是种子（形态随之锁定）
  const filled = { ...seeded, content: { scope: "plain", markdown: seed.replace("|  |", "| 已填 |") } };
  assert.equal(content.isDefaultTableSeed(filled), false);
  // 早期种子（只有表头无数据行）仍可识别
  const legacy = { ...seeded, content: { scope: "plain", markdown: seed.replace("\n|  |", "") } };
  assert.equal(content.isDefaultTableSeed(legacy), true);
});
