import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  // 打包目标其实是 workerd/浏览器：不补条件时 @modelcontextprotocol/server 会解析到 node shim（node:process），
  // 整个 worker 入口打不出来，这批集成测试会集体失败。
  conditions: ["worker", "browser"], loader: { ".sql": "text" },
});

async function withWorker(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "sync-test", compatibilityDate: "2026-10-30",
    env: { DB: { type: "d1", id: "test-sync-database" }, BUCKET: { type: "r2", name: "test-sync-bucket" }, AUTH_PEPPER: { type: "text", value: "test-only-pepper" } },
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] });
  try { await run(mf); } finally { await mf.dispose(); }
}
const req = (mf, path, init) => mf.dispatchFetch(`http://localhost${path}`, init);

async function loginCookie(mf) {
  assert.equal((await req(mf, "/api/health/ready")).status, 200);
  const boot = await req(mf, "/api/auth/bootstrap", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ username: "owner", password: "owner-password-1" }),
  });
  assert.equal(boot.status, 201);
  return boot.headers.get("set-cookie").split(";")[0];
}

const post = (mf, cookie, operations) => req(mf, "/api/sync/push", {
  method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie },
  body: JSON.stringify({ deviceId: "device-a", operations }),
});

function topicOp(topicId) {
  return { operationId: crypto.randomUUID(), userId: "ignored", entityId: topicId, entity: "topic", action: "upsert", baseRev: 0, baseMetaRev: 0, payload: { topic: { id: topicId, userId: "ignored", parentId: null, name: "工作", depth: 0, isEncSpace: false, deletedAt: null } } };
}

function itemOp(id, { rev, baseRev = rev - 1, markdown = "正文", title = "笔记", metaRev = rev, baseMetaRev = metaRev - 1, hashes = [], conflictOf = null } = {}) {
  return {
    operationId: crypto.randomUUID(), userId: "ignored", entityId: id, entity: "item", action: "upsert",
    baseRev, baseMetaRev, contentHash: "hash-" + markdown,
    attachmentRefs: hashes,
    payload: { item: {
      id, userId: "ignored", type: "note", topicId: null, groupId: null, title, tags: [], status: null,
      attachmentHashes: hashes, source: "manual", rev, metaRev, contentHash: "hash-" + markdown,
      pinned: false, starred: false, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 + rev, deletedAt: null,
      content: { scope: "plain", markdown }, ...(conflictOf ? { conflictOf } : {}),
    } },
  };
}

function memoCommentOp(id, memoId, parentId, content) {
  const now = 1_700_000_000_000;
  return { operationId: crypto.randomUUID(), userId: "ignored", entityId: id, entity: "memo_comment", action: "upsert", baseRev: 0, baseMetaRev: 0,
    payload: { comment: { id, userId: "ignored", memoId, parentId, content, rev: 1, createdAt: now, updatedAt: now, deletedAt: null } } };
}
function memoCommentDeleteOp(id, memoId, parentId) {
  const now = Date.now();
  return { operationId: crypto.randomUUID(), userId: "ignored", entityId: id, entity: "memo_comment", action: "delete", baseRev: 1, baseMetaRev: 0,
    payload: { comment: { id, userId: "ignored", memoId, parentId, content: "", rev: 2, createdAt: 1_700_000_000_000, updatedAt: now, deletedAt: now } } };
}

test("Memo comments sync one reply level and keep the parent reference", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const memo = itemOp("memo-thread", { rev: 1, markdown: "随记" });
    memo.payload.item.type = "memo";
    memo.payload.item.title = null;
    const response = await post(mf, cookie, [memo, memoCommentOp("comment-root", "memo-thread", null, "根评论"), memoCommentOp("comment-reply", "memo-thread", "comment-root", "回复")]);
    const results = (await response.json()).results;
    assert.deepEqual(results.map((result) => result.result), ["applied", "applied", "applied"]);
    const db = await mf.getD1Database("DB");
    const reply = await db.prepare("SELECT parent_id, content_markdown FROM memo_comments WHERE id = ?").bind("comment-reply").first();
    assert.deepEqual(reply, { parent_id: "comment-root", content_markdown: "回复" });
    const invalid = await post(mf, cookie, [memoCommentOp("comment-nested", "memo-thread", "comment-reply", "不允许二级回复")]);
    assert.equal((await invalid.json()).results[0].result, "rejected");
    const deleted = await post(mf, cookie, [memoCommentDeleteOp("comment-root", "memo-thread", null), memoCommentDeleteOp("comment-reply", "memo-thread", "comment-root")]);
    assert.deepEqual((await deleted.json()).results.map((result) => result.result), ["applied", "applied"]);
    const rows = await db.prepare("SELECT id, deleted_at FROM memo_comments WHERE id IN (?, ?) ORDER BY id").bind("comment-reply", "comment-root").all();
    assert.equal(rows.results.length, 2);
    assert.ok(rows.results.every((row) => row.deleted_at !== null));
  });
});

test("push applies operations atomically per operation with idempotent replay (G2 §3/§6)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    let response = await post(mf, cookie, [topicOp("t1")]);
    assert.equal((await response.json()).results[0].result, "applied");
    const create = itemOp("i1", { rev: 1 });
    response = await post(mf, cookie, [create]);
    const first = (await response.json()).results[0];
    assert.equal(first.result, "applied");
    assert.equal(first.rev, 1);
    // 同 operation_id 重放 → duplicate（幂等，G2 §6）
    response = await post(mf, cookie, [{ ...create, operationId: create.operationId }]);
    assert.equal((await response.json()).results[0].result, "duplicate");
    // 更新 baseRev=1 → applied rev=2
    response = await post(mf, cookie, [itemOp("i1", { rev: 2, markdown: "正文二" })]);
    assert.equal((await response.json()).results[0].result, "applied");
    // 过期 baseRev 且内容不同 → conflict，detail 带服务端当前值（G2 §5-2）
    response = await post(mf, cookie, [itemOp("i1", { rev: 2, baseRev: 1, markdown: "过期分支" })]);
    const conflict = (await response.json()).results[0];
    assert.equal(conflict.result, "conflict");
    assert.equal(conflict.detail.rev, 2);
    // 相同 contentHash 的重放 → duplicate 且不新增版本（G2 §5-1）
    response = await post(mf, cookie, [itemOp("i1", { rev: 2, baseRev: 1, markdown: "正文二" })]);
    assert.equal((await response.json()).results[0].result, "duplicate");
    const database = await mf.getD1Database("DB");
    assert.equal((await database.prepare("SELECT rev FROM items WHERE id = 'i1'").first()).rev, 2);
  });
});

/** 元数据操作（改标题/标签/归属）：操作层不带 contentHash（G2 §3：正文操作必带 contentHash）。 */
function metaItemOp(id, { rev, baseRev, baseMetaRev, metaRev, title = "笔记", markdown = "正文", tags = [] } = {}) {
  const op = itemOp(id, { rev, baseRev, baseMetaRev, metaRev, title, markdown });
  delete op.contentHash;
  op.payload.item.tags = tags;
  return op;
}

test("two content saves in one batch both apply; content write leaves meta_rev alone (G2 §1/§5-1)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i30", { rev: 1, baseRev: 0, baseMetaRev: 0, metaRev: 1 })]);
    // 连续两次自动保存落进同一批：本地 rev 1→2→3，metaRev 始终 1（G2 §1：正文写只推进 rev）
    const first = itemOp("i30", { rev: 2, baseRev: 1, baseMetaRev: 1, metaRev: 1, markdown: "第二次保存" });
    const second = itemOp("i30", { rev: 3, baseRev: 2, baseMetaRev: 1, metaRev: 1, markdown: "第三次保存" });
    const results = (await (await post(mf, cookie, [first, second])).json()).results;
    assert.equal(results[0].result, "applied");
    assert.equal(results[1].result, "applied");
    const row = await (await mf.getD1Database("DB")).prepare("SELECT rev, meta_rev, content_markdown FROM items WHERE id = 'i30'").first();
    assert.equal(row.rev, 3);
    assert.equal(row.meta_rev, 1);
    assert.equal(row.content_markdown, "第三次保存");
  });
});

test("meta write leaves content rev alone; meta then content in one batch both apply (G2 §1/§5-3)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i31", { rev: 1, baseRev: 0, baseMetaRev: 0, metaRev: 1 })]);
    // 改标题：只推进元数据版本，正文版本不动（G2 §1）
    const rename = metaItemOp("i31", { rev: 1, baseRev: 1, baseMetaRev: 1, metaRev: 2, title: "新标题" });
    assert.equal((await (await post(mf, cookie, [rename])).json()).results[0].result, "applied");
    const renamed = await (await mf.getD1Database("DB")).prepare("SELECT rev, meta_rev, title, content_markdown FROM items WHERE id = 'i31'").first();
    assert.equal(renamed.rev, 1);
    assert.equal(renamed.meta_rev, 2);
    assert.equal(renamed.title, "新标题");
    assert.equal(renamed.content_markdown, "正文");
    // 随后改正文：baseRev 仍是 1（正文版本没动过），不该被判成冲突
    const body = itemOp("i31", { rev: 2, baseRev: 1, baseMetaRev: 2, metaRev: 2, markdown: "正文一改" });
    assert.equal((await (await post(mf, cookie, [body])).json()).results[0].result, "applied");
    const after = await (await mf.getD1Database("DB")).prepare("SELECT rev, meta_rev, content_markdown FROM items WHERE id = 'i31'").first();
    assert.equal(after.rev, 2);
    assert.equal(after.meta_rev, 2);
    assert.equal(after.content_markdown, "正文一改");
  });
});

test("stale meta write loses to the server and never advances content rev (G2 §5-3)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i32", { rev: 1, baseRev: 0, baseMetaRev: 0, metaRev: 1 })]);
    // 另一端改了标题：meta_rev 推到 2
    await post(mf, cookie, [metaItemOp("i32", { rev: 1, baseRev: 1, baseMetaRev: 1, metaRev: 2, title: "他端标题" })]);
    // 本端拿着过期 meta_rev 再改标题 → conflict，服务端胜出（不生成副本）
    const stale = metaItemOp("i32", { rev: 1, baseRev: 1, baseMetaRev: 1, metaRev: 2, title: "本端标题" });
    const result = (await (await post(mf, cookie, [stale])).json()).results[0];
    assert.equal(result.result, "conflict");
    assert.equal(result.detail.metaRev, 2);
    const row = await (await mf.getD1Database("DB")).prepare("SELECT rev, meta_rev, title FROM items WHERE id = 'i32'").first();
    assert.equal(row.title, "他端标题");
    assert.equal(row.rev, 1);
  });
});

test("conflict reaches the client through pull so the item converges (G2 §4/§5-2)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i33", { rev: 1, baseRev: 0, baseMetaRev: 0, metaRev: 1 })]);
    // 过期正文版本 + 不同正文 → 真冲突
    const stale = itemOp("i33", { rev: 2, baseRev: 0, baseMetaRev: 1, metaRev: 2, markdown: "冲突分支" });
    const result = (await (await post(mf, cookie, [stale])).json()).results[0];
    assert.equal(result.result, "conflict");
    assert.equal(result.detail.rev, 1);
    // 冲突也要落 sync_log：客户端拉得到服务端当前版本，条目才能收敛；
    // 否则本地版本号停在旧值，下次保存又撞同一条前置条件，冲突副本会反复出现。
    const response = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    const page = await response.json();
    const pulled = page.items.find((item) => item.id === "i33");
    assert.equal(pulled.rev, 1);
    assert.equal(pulled.content.markdown, "正文");
  });
});

test("content write from a metadata-stale client keeps the server-side metadata (G2 §5-3)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i40", { rev: 1, baseRev: 0, baseMetaRev: 0, metaRev: 1 })]);
    // 另一端改了标题：服务端 meta_rev 推到 2
    await post(mf, cookie, [metaItemOp("i40", { rev: 1, baseRev: 1, baseMetaRev: 1, metaRev: 2, title: "他端标题" })]);
    // 本端元数据版本落后（base_meta_rev=1）却写了正文：正文照落，标题保持服务端值
    const body = itemOp("i40", { rev: 2, baseRev: 1, baseMetaRev: 1, metaRev: 1, markdown: "本地正文" });
    const result = (await (await post(mf, cookie, [body])).json()).results[0];
    assert.equal(result.result, "applied");
    const row = await (await mf.getD1Database("DB")).prepare("SELECT rev, meta_rev, title, content_markdown FROM items WHERE id = 'i40'").first();
    assert.equal(row.content_markdown, "本地正文");
    assert.equal(row.title, "他端标题");
    assert.equal(row.rev, 2);
    assert.equal(row.meta_rev, 2);
  });
});

test("conflict copies keep their link to the source item (G2 §5-2)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i41", { rev: 1, baseRev: 0, baseMetaRev: 0, metaRev: 1, conflictOf: "orig-1" })]);
    const response = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    const page = await response.json();
    const pulled = page.items.find((item) => item.id === "i41");
    assert.equal(pulled.conflictOf, "orig-1");
  });
});

test("delete then edit wins as resurrection; tombstones propagate via pull (G2 §5-5)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("i2", { rev: 1 })]);
    // 删除（baseRev 1）→ applied
    let response = await post(mf, cookie, [{
      operationId: crypto.randomUUID(), userId: "x", entityId: "i2", entity: "item", action: "delete",
      baseRev: 1, baseMetaRev: 1, payload: { deletedAt: 1_700_000_100_000 },
    }]);
    assert.equal((await response.json()).results[0].result, "applied");
    // 编辑（baseRev 2，删除侧已把 rev 推到 2）→ 复活
    response = await post(mf, cookie, [itemOp("i2", { rev: 2, baseRev: 1, baseMetaRev: 1, markdown: "复活正文" })]);
    assert.equal((await response.json()).results[0].result, "applied");
    const database = await mf.getD1Database("DB");
    const row = await database.prepare("SELECT deleted_at, content_markdown FROM items WHERE id = 'i2'").first();
    assert.equal(row.deleted_at, null);
    assert.equal(row.content_markdown, "复活正文");
    // 墓碑与复活都进 sync_log，拉取可见
    response = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    const page = await response.json();
    assert.equal(page.items.some((item) => item.id === "i2"), true);
    assert.equal(page.items.find((item) => item.id === "i2").deletedAt, null);
    assert.equal(page.items.find((item) => item.id === "i2").content.markdown, "复活正文");
  });
});

test("attachment reference counts realign from the authoritative item table (FR-SYNC-7)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const hash = "a".repeat(64);
    await post(mf, cookie, [itemOp("i3", { rev: 1, hashes: [hash] }), itemOp("i4", { rev: 1, hashes: [hash] })]);
    const database = await mf.getD1Database("DB");
    assert.equal((await database.prepare("SELECT ref_count FROM attachments WHERE sha256 = ?", ).bind(hash).first()).ref_count, 2);
    await post(mf, cookie, [itemOp("i4", { rev: 2, baseRev: 1, markdown: "正文二", hashes: [] })]);
    assert.equal((await database.prepare("SELECT ref_count FROM attachments WHERE sha256 = ?").bind(hash).first()).ref_count, 1);
  });
});

test("pull advances the cursor page by page; stale cursor triggers fullResync (G2 §4)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    await post(mf, cookie, [itemOp("p1", { rev: 1 }), itemOp("p2", { rev: 1 }), itemOp("p3", { rev: 1 })]);
    let page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.fullResync, false);
    assert.equal(page.items.length, 3);
    assert.equal(page.hasMore, false);
    const cursor = Number(page.nextCursor);
    page = await (await req(mf, `/api/sync/pull?cursor=${cursor}`, { headers: { cookie } })).json();
    assert.equal(page.items.length, 0);
    // 人为收缩保留窗口：删掉早期日志后，旧游标触发 fullResync
    const database = await mf.getD1Database("DB");
    await database.prepare("DELETE FROM sync_log WHERE seq <= 2").run();
    page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.fullResync, true);
    assert.ok(page.items.length >= 3);
  });
});

test("fullResync pages past 200 items and only then returns a log cursor", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const ops = [];
    for (let index = 0; index < 201; index += 1) ops.push(itemOp("bulk-" + index, { rev: 1, title: "n" + index }));
    for (let offset = 0; offset < ops.length; offset += 10) {
      assert.equal((await post(mf, cookie, ops.slice(offset, offset + 10))).status, 200);
    }
    const database = await mf.getD1Database("DB");
    await database.prepare("DELETE FROM sync_log WHERE seq <= 2").run();
    const first = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(first.fullResync, true);
    assert.equal(first.items.length, 200);
    assert.equal(first.hasMore, true);
    assert.match(first.nextCursor, /^full:/);
    const second = await (await req(mf, `/api/sync/pull?cursor=${encodeURIComponent(first.nextCursor)}`, { headers: { cookie } })).json();
    assert.equal(second.fullResync, true);
    assert.equal(second.hasMore, false);
    assert.match(second.nextCursor, /^\d+$/);
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    assert.equal(ids.size, 201);
  });
});

test("topic upsert keeps a moved group's parent", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const topic = topicOp("topic-a");
    const group = topicOp("group-a");
    group.payload.topic.parentId = "topic-a";
    group.payload.topic.depth = 1;
    group.payload.topic.name = "分组";
    assert.equal((await post(mf, cookie, [topic, group])).status, 200);
    group.operationId = crypto.randomUUID();
    group.payload.topic.parentId = "topic-b";
    const other = topicOp("topic-b");
    other.payload.topic.name = "另一主题";
    assert.equal((await post(mf, cookie, [other, group])).status, 200);
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.topics.find((row) => row.id === "group-a").parentId, "topic-b");
  });
});

test("push requires a session and rejects malformed payloads as rejected results", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    assert.equal((await req(mf, "/api/sync/pull", {})).status, 401);
    assert.equal((await post(mf, cookie, [])).status, 400);
    const broken = itemOp("ghost", { rev: 1 });
    broken.payload.item.type = "note";
    delete broken.payload.item.title; // note 无标题违反 CHECK → rejected
    const response = await post(mf, cookie, [broken]);
    const result = (await response.json()).results[0];
    assert.equal(result.result, "rejected");
  });
});

test("encrypted items carry key wraps through push and pull (G7)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const wrap = { wrapper: "password", kdfSalt: "c2FsdA==", kdfIterations: 600000, iv: "aXYxMg==", ciphertext: "d3JhcA==", generation: 0 };
    const item = itemOp("enc1", { rev: 1, markdown: "" });
    item.payload.item.content = { scope: "self", ciphertext: "aXYxMjpzZWFsZWQ=" };
    item.payload.item.title = "加密笔记";
    item.wraps = [wrap];
    let response = await post(mf, cookie, [item]);
    assert.equal((await response.json()).results[0].result, "applied");
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.items.find((row) => row.id === "enc1").content.scope, "self");
    assert.deepEqual(page.wraps, [{ itemId: "enc1", wraps: [wrap] }]);
    assert.deepEqual(page.topicWraps, []);
  });
});

function settingOp(key, value, baseRev = 0) {
  return {
    operationId: crypto.randomUUID(), userId: "ignored", entityId: key, entity: "setting", action: "upsert",
    baseRev, baseMetaRev: 0,
    payload: { setting: { userId: "ignored", key, sensitivity: "ordinary", value, rev: baseRev + 1, updatedAt: 1 } },
  };
}

test("ai and raindrop settings sync; unknown setting keys stay rejected", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const ai = settingOp("ai", { enabled: true, model: "@cf/zai-org/glm-4.7-flash", dailyCallLimit: 50 });
    const raindrop = settingOp("raindrop", { enabled: true });
    const junk = settingOp("token", { secret: "nope" });
    const pushed = await post(mf, cookie, [ai, raindrop, junk]);
    const results = (await pushed.json()).results;
    assert.equal(results.find((row) => row.operationId === ai.operationId).result, "applied");
    assert.equal(results.find((row) => row.operationId === raindrop.operationId).result, "applied");
    assert.equal(results.find((row) => row.operationId === junk.operationId).result, "rejected");
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.settings.find((row) => row.key === "ai").value.enabled, true);
    assert.equal(page.settings.find((row) => row.key === "raindrop").value.enabled, true);
    assert.equal(page.settings.some((row) => row.key === "token"), false);
  });
});

test("setting op previously recorded as rejected re-applies on same operationId re-push", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const ai = settingOp("ai", { enabled: true, model: "@cf/zai-org/glm-4.7-flash", dailyCallLimit: 50 });
    // 模拟旧服务端白名单只收 appearance 时留下的 rejected 幂等记录（0.1.10 前的真实存量）
    const database = await mf.getD1Database("DB");
    await database.prepare(
      `INSERT INTO sync_operations (user_id, operation_id, entity, entity_id, result, rev, meta_rev, content_hash, created_at)
       VALUES ((SELECT id FROM users LIMIT 1), ?, 'setting', 'ai', 'rejected', 0, 0, NULL, 1)`,
    ).bind(ai.operationId).run();
    const pushed = await post(mf, cookie, [ai]);
    assert.equal((await pushed.json()).results[0].result, "applied");
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.settings.find((row) => row.key === "ai").value.enabled, true);
    // 应用后的重放仍走幂等 duplicate
    const replay = await post(mf, cookie, [ai]);
    assert.equal((await replay.json()).results[0].result, "duplicate");
  });
});

test("rejected record re-push with still-invalid key rejects again without wedging the batch", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const junk = settingOp("token", { secret: "nope" });
    const ai = settingOp("ai", { enabled: true, model: "@cf/zai-org/glm-4.7-flash", dailyCallLimit: 50 });
    const database = await mf.getD1Database("DB");
    await database.prepare(
      `INSERT INTO sync_operations (user_id, operation_id, entity, entity_id, result, rev, meta_rev, content_hash, created_at)
       VALUES ((SELECT id FROM users LIMIT 1), ?, 'setting', 'token', 'rejected', 0, 0, NULL, 1)`,
    ).bind(junk.operationId).run();
    const pushed = await post(mf, cookie, [junk, ai]);
    const results = (await pushed.json()).results;
    assert.equal(results.find((row) => row.operationId === junk.operationId).result, "rejected");
    assert.equal(results.find((row) => row.operationId === ai.operationId).result, "applied");
  });
});

test("private space topic wraps travel through push and pull (FR-ENC-1)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const password = { wrapper: "password", kdfSalt: "c2FsdA==", kdfIterations: 600000, iv: "aXYxMg==", ciphertext: "d3JhcA==", generation: 0 };
    const recovery = { wrapper: "recovery", kdfSalt: "c2FsdDI=", kdfIterations: 600000, iv: "aXYyMg==", ciphertext: "cmVjb3Zlcnk=", generation: 0 };
    const topicId = "space-1";
    const operation = {
      ...topicOp(topicId),
      wraps: [password, recovery],
      payload: { topic: { id: topicId, userId: "ignored", parentId: null, name: "私人空间", depth: 0, isEncSpace: true, deletedAt: null } },
    };
    const pushed = await post(mf, cookie, [operation]);
    assert.equal((await pushed.json()).results[0].result, "applied");
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    const topic = page.topics.find((row) => row.id === topicId);
    assert.equal(topic.isEncSpace, true);
    assert.deepEqual(page.topicWraps, [{ topicId, wraps: [password, recovery] }]);
  });
});
