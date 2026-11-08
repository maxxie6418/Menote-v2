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
    name: "backup-test", compatibilityDate: "2026-10-30",
    env: { DB: { type: "d1", id: "test-backup-db" }, BUCKET: { type: "r2", name: "test-backup-bucket" }, AUTH_PEPPER: { type: "text", value: "test-only-pepper" } },
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] });
  try { await run(mf); } finally { await mf.dispose(); }
}
const req = (mf, path, init) => mf.dispatchFetch(`http://localhost${path}`, init);
const json = (mf, cookie, method, path, body) => req(mf, path, {
  method, headers: { "content-type": "application/json", origin: "http://localhost", cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function login(mf) {
  assert.equal((await req(mf, "/api/health/ready")).status, 200);
  const boot = await json(mf, "", "POST", "/api/auth/bootstrap", { username: "owner", password: "owner-password-1" });
  return boot.headers.get("set-cookie").split(";")[0];
}

test("backup target CRUD with reversible secret storage and reveal (FR-BAK-1, C-7)", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const created = await json(mf, cookie, "POST", "/api/backup/targets", {
      kind: "webdav", endpoint: "https://dav.example.invalid/dav", username: "user", secret: "secret-value-123", schedule: "daily", name: "主备份",
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const list = await (await json(mf, cookie, "GET", "/api/backup/targets")).json();
    assert.equal(list.targets.length, 1);
    assert.equal(list.targets[0].name, "主备份");
    assert.match(list.targets[0].secretCiphertext, /^[A-Za-z0-9+/=]+$/);
    assert.equal(list.targets[0].secretCiphertext.includes("secret-value-123"), false, "明文凭据不入库");
    const revealed = await (await json(mf, cookie, "GET", `/api/backup/targets/${id}/secret`)).json();
    assert.equal(revealed.secret, "secret-value-123");
    // 停用后 run 被拒（409）
    assert.equal((await json(mf, cookie, "PATCH", `/api/backup/targets/${id}`, { enabled: false })).status, 200);
    assert.equal((await json(mf, cookie, "POST", `/api/backup/run/${id}`)).status, 409);
    // 隔离：另一 cookie 看不到
    const second = await json(mf, cookie, "POST", "/api/auth/registration", { open: true });
    assert.equal(second.status, 200);
    const reg = await json(mf, cookie, "POST", "/api/auth/register", { username: "alice", password: "alice-password-1" });
    const aliceCookie = reg.headers.get("set-cookie").split(";")[0];
    const aliceList = await (await json(mf, aliceCookie, "GET", "/api/backup/targets")).json();
    assert.equal(aliceList.targets.length, 0, "备份目标按用户隔离（FR-USR-2）");
  });
});

test("restore import merges backup entries by id (FR-BAK-9 工具侧)", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const entries = [
      { kind: "topic", data: { id: "t1", user_id: "x", parent_id: null, name: "恢复主题", depth: 0, is_enc_space: 0, deleted_at: null, created_at: 1_700_000_000_000 } },
      { kind: "item", data: { id: "ri1", user_id: "x", type: "note", topic_id: null, group_id: null, title: "恢复的笔记", content_markdown: "恢复正文", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 3, meta_rev: 1, content_hash: "h1", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, deleted_at: null } },
    ];
    const response = await json(mf, cookie, "POST", "/api/restore", { entries, itemKeyWraps: [] });
    assert.deepEqual(await response.json(), { ok: true, items: 1, topics: 1, memoComments: 0, topicWraps: 0, settings: 0, skipped: 0 });
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.items.find((item) => item.id === "ri1").title, "恢复的笔记");
    assert.equal(page.topics.find((topic) => topic.id === "t1").name, "恢复主题");
  });
});

test("restore imports Memo comments together with their Memo owner atomically", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const response = await json(mf, cookie, "POST", "/api/restore", { entries: [
      { kind: "item", data: { id: "restore-memo", type: "memo", topic_id: null, group_id: null, title: null, content_markdown: "memo body", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 1, meta_rev: 0, content_hash: "memo-hash", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
      { kind: "memo_comment", data: { id: "restore-comment", user_id: "x", memo_id: "restore-memo", content_markdown: "comment", rev: 1, created_at: 1, updated_at: 1, deleted_at: null } },
    ] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).memoComments, 1);
    const db = await mf.getD1Database("DB");
    const comment = await db.prepare("SELECT content_markdown FROM memo_comments WHERE id = 'restore-comment'").first();
    assert.equal(comment.content_markdown, "comment");
  });
});

test("restore import rolls back all rows if any batched write fails", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TRIGGER fail_restore_log BEFORE INSERT ON sync_log WHEN NEW.entity_id = 'atomic-item' BEGIN SELECT RAISE(FAIL, 'injected restore failure'); END;");
    const entries = [
      { kind: "item", data: { id: "atomic-item", type: "note", topic_id: null, group_id: null, title: "atomic", content_markdown: "body", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 1, meta_rev: 0, content_hash: "h", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
    ];
    const response = await json(mf, cookie, "POST", "/api/restore", { entries });
    assert.equal(response.status, 400);
    const item = await db.prepare("SELECT id FROM items WHERE id = 'atomic-item'").first();
    assert.equal(item, null, "the D1 batch must roll back the row written before the failing log insert");
  });
});

test("restore rejects garbage key wraps and accepts explicit base64", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const entries = [
      { kind: "item", data: { id: "enc1", user_id: "x", type: "note", topic_id: null, group_id: null, title: "加密", content_markdown: null, content_ciphertext: { $b64: btoa("iv:cipher") }, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 2, meta_rev: 1, content_hash: "h", pinned: 0, starred: 0, enc_self: 1, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
    ];
    const bad = await json(mf, cookie, "POST", "/api/restore", {
      entries,
      itemKeyWraps: [{ item_id: "enc1", wrapper: "password", kdf_salt: { not: "bytes" }, kdf_iterations: 1, iv: "aaaa", ciphertext: "aaaa", generation: 0 }],
    });
    assert.equal(bad.status, 400);
    const salt = btoa("salt-bytes");
    const iv = btoa("iv-bytes-12!");
    const sealed = btoa("cipher-bytes");
    const good = await json(mf, cookie, "POST", "/api/restore", {
      entries,
      itemKeyWraps: [{ item_id: "enc1", wrapper: "password", kdf_salt: { $b64: salt }, kdf_iterations: 1, iv: { $b64: iv }, ciphertext: { $b64: sealed }, generation: 1 }],
      topicKeyWraps: [{ topic_id: "space", wrapper: "password", kdf_salt: { $b64: salt }, kdf_iterations: 1, iv: { $b64: iv }, ciphertext: { $b64: sealed }, generation: 1 }],
    });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(body.skipped, 0);
    assert.equal(body.topicWraps, 1);
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    const item = page.items.find((row) => row.id === "enc1");
    assert.equal(item.content.ciphertext, "iv:cipher");
    assert.equal(page.wraps.find((group) => group.itemId === "enc1").wraps[0].kdfSalt, salt);
  });
});

test("restore skips orphaned replies instead of failing the whole batch", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const response = await json(mf, cookie, "POST", "/api/restore", { entries: [
      { kind: "item", data: { id: "orphan-memo", type: "memo", topic_id: null, group_id: null, title: null, content_markdown: "memo", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 1, meta_rev: 0, content_hash: "h", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
      { kind: "memo_comment", data: { id: "orphan-root", user_id: "x", memo_id: "orphan-memo", content_markdown: "root", rev: 1, created_at: 1, updated_at: 1, deleted_at: null } },
      { kind: "memo_comment", data: { id: "orphan-reply", user_id: "x", memo_id: "orphan-memo", parent_id: "missing-parent", content_markdown: "reply", rev: 1, created_at: 2, updated_at: 2, deleted_at: null } },
    ] });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memoComments, 1, "根评论正常导入");
    assert.equal(body.skipped, 1, "孤儿回复跳过并计数");
    const db = await mf.getD1Database("DB");
    const reply = await db.prepare("SELECT id FROM memo_comments WHERE id = 'orphan-reply'").first();
    assert.equal(reply, null);
    const root = await db.prepare("SELECT content_markdown FROM memo_comments WHERE id = 'orphan-root'").first();
    assert.equal(root.content_markdown, "root");
  });
});

test("restore does not roll newer content back to an older backup revision", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const row = (rev, markdown) => ({ id: "rev-item", type: "note", topic_id: null, group_id: null, title: "t", content_markdown: markdown, content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev, meta_rev: 0, content_hash: `h-${markdown}`, pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null });
    await json(mf, cookie, "POST", "/api/restore", { entries: [{ kind: "item", data: row(5, "新版正文") }] });
    const second = await json(mf, cookie, "POST", "/api/restore", { entries: [{ kind: "item", data: row(3, "旧版正文") }] });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, items: 0, topics: 0, memoComments: 0, topicWraps: 0, settings: 0, skipped: 1 });
    const db = await mf.getD1Database("DB");
    const item = await db.prepare("SELECT content_markdown, rev FROM items WHERE id = 'rev-item'").first();
    assert.deepEqual(item, { content_markdown: "新版正文", rev: 5 });
  });
});
