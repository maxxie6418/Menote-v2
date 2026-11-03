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

function itemOp(id, { rev, baseRev = rev - 1, markdown = "正文", title = "笔记", metaRev = rev, baseMetaRev = metaRev - 1, hashes = [] } = {}) {
  return {
    operationId: crypto.randomUUID(), userId: "ignored", entityId: id, entity: "item", action: "upsert",
    baseRev, baseMetaRev, contentHash: "hash-" + markdown,
    attachmentRefs: hashes,
    payload: { item: {
      id, userId: "ignored", type: "note", topicId: null, groupId: null, title, tags: [], status: null,
      attachmentHashes: hashes, source: "manual", rev, metaRev, contentHash: "hash-" + markdown,
      pinned: false, starred: false, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 + rev, deletedAt: null,
      content: { scope: "plain", markdown },
    } },
  };
}

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
    await post(mf, cookie, [itemOp("i4", { rev: 2, baseRev: 1, hashes: [] })]);
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
