import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

/** 附件读写回归（FR-SYNC-7）：读取必须走会话解析——`/api/attachments/:sha256` 是子路径，
 *  中间件挂成精确路径时 requireSession 拿不到 authUser，图片一律 401，正文里就是裂图。 */

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  // 打包目标其实是 workerd/浏览器：不补条件时 @modelcontextprotocol/server 会解析到 node shim（node:process），
  // 整个 worker 入口打不出来，这批集成测试会集体失败。
  conditions: ["worker", "browser"], loader: { ".sql": "text" },
});
globalThis.crypto ??= webcrypto;
const cleanupBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/attachmentService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const { cleanupAttachments, deleteUserAttachment } = await import(
  `data:text/javascript;base64,${Buffer.from(cleanupBundle.outputFiles[0].text).toString("base64")}`
);

async function withWorker(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "attachments-test", compatibilityDate: "2026-10-30",
    env: { DB: { type: "d1", id: "test-attachments-db" }, BUCKET: { type: "r2", name: "test-attachments-bucket" }, AUTH_PEPPER: { type: "text", value: "test-only-pepper" } },
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

/** 1×1 透明 PNG。 */
const PNG = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
));

const DAY = 86_400_000;
const upload = (mf, cookie) => req(mf, "/api/attachments", {
  method: "POST", headers: { "content-type": "image/png", "X-File-Extension": ".png", origin: "http://localhost", cookie }, body: PNG,
});
const attachmentKey = async (db, hash) => (await db.prepare("SELECT r2_key FROM attachments WHERE sha256 = ?").bind(hash).first()).r2_key;
async function ageOrphan(db, hash) {
  await db.prepare("UPDATE attachments SET orphaned_at = ? WHERE sha256 = ?").bind(Date.now() - 31 * DAY, hash).run();
}

test("元数据落库失败后，计划任务回收未发布的对象", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    await db.exec("CREATE TRIGGER fail_attachment_insert BEFORE INSERT ON attachments BEGIN SELECT RAISE(FAIL, 'injected metadata failure'); END;");
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    const response = await upload(mf, cookie);
    assert.equal(response.status, 503);
    const stage = await db.prepare("SELECT object_key FROM attachment_object_deletions").first();
    assert.ok(stage.object_key.includes(sha256));
    assert.notEqual(await bucket.head(stage.object_key), null);
    await cleanupAttachments({ db, bucket }, Date.now() + 2 * DAY);
    assert.equal(await bucket.head(stage.object_key), null);
    assert.equal(await db.prepare("SELECT object_key FROM attachment_object_deletions").first(), null);
  });
});

test("手动清理保护观察期，清理到期对象并拒绝断链引用", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    const { sha256 } = await (await upload(mf, cookie)).json();
    const key = await attachmentKey(db, sha256);
    const path = `/api/attachments/${sha256}`;
    const remove = () => req(mf, path, { method: "DELETE", headers: { origin: "http://localhost", cookie } });
    const protectedResponse = await remove();
    assert.equal(protectedResponse.status, 409);
    assert.deepEqual(await protectedResponse.json(), { error: "attachment_retention_active" });
    await ageOrphan(db, sha256);
    assert.equal((await remove()).status, 204);
    assert.equal(await bucket.head(key), null);
    assert.equal(await db.prepare("SELECT object_key FROM attachment_object_deletions WHERE object_key = ?").bind(key).first(), null);
    assert.equal((await req(mf, path, { headers: { cookie } })).status, 404);
    assert.deepEqual(await (await req(mf, "/api/attachments", { headers: { cookie } })).json(), { attachments: [] });
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    await assert.rejects(() => db.prepare(`INSERT INTO items
      (id, user_id, type, title, content_markdown, content_hash, tags_json, attachment_hashes_json, source, rev, meta_rev, created_at, updated_at)
      VALUES ('would-break', ?, 'note', '标题', '正文', 'h', '[]', ?, 'manual', 1, 1, 1, 1)`)
      .bind(user.id, JSON.stringify([sha256])).run(), /attachment_retired/);
  });
});

test("旧世代删除挂起时，重新上传和新增引用保持新世代完整", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const { sha256 } = await (await upload(mf, cookie)).json();
    const oldKey = await attachmentKey(db, sha256);
    await ageOrphan(db, sha256);

    const entered = Promise.withResolvers();
    const resume = Promise.withResolvers();
    const stalledBucket = {
      async delete(keys) {
        entered.resolve(keys);
        await resume.promise;
        await bucket.delete(keys);
      },
    };
    const deletion = deleteUserAttachment({ db, bucket: stalledBucket }, user.id, sha256);
    try {
      assert.deepEqual(await Promise.race([entered.promise, deletion]), [oldKey]);
      assert.equal((await upload(mf, cookie)).status, 201);
      const replacement = await attachmentKey(db, sha256);
      assert.notEqual(replacement, oldKey);
      await db.prepare(`INSERT INTO items
        (id, user_id, type, title, content_markdown, content_hash, tags_json, attachment_hashes_json, source, rev, meta_rev, created_at, updated_at)
        VALUES ('replacement-ref', ?, 'note', '标题', '正文', 'h', '[]', ?, 'manual', 1, 1, 1, 1)`)
        .bind(user.id, JSON.stringify([sha256])).run();
      resume.resolve();
      assert.equal(await deletion, "deleted");
      assert.equal(await bucket.head(oldKey), null);
      assert.notEqual(await bucket.head(replacement), null);
      assert.equal((await req(mf, `/api/attachments/${sha256}`, { headers: { cookie } })).status, 200);
    } finally {
      resume.resolve();
      await deletion;
    }
  });
});

test("R2 删除失败保留队列，下一次计划任务安全重试", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const { sha256 } = await (await upload(mf, cookie)).json();
    const key = await attachmentKey(db, sha256);
    await ageOrphan(db, sha256);
    const unavailableBucket = { async delete() { throw new Error("temporary R2 failure"); } };
    await assert.rejects(() => deleteUserAttachment({ db, bucket: unavailableBucket }, user.id, sha256), /temporary R2 failure/);
    assert.notEqual(await bucket.head(key), null);
    assert.equal((await req(mf, `/api/attachments/${sha256}`, { headers: { cookie } })).status, 404);
    assert.equal((await db.prepare("SELECT claimed FROM attachment_object_deletions WHERE object_key = ?").bind(key).first()).claimed, 1);
    await cleanupAttachments({ db, bucket }, Date.now());
    assert.equal(await bucket.head(key), null);
    assert.equal(await db.prepare("SELECT object_key FROM attachment_object_deletions").first(), null);
  });
});

test("附件上传后可用会话读回（图片不再 401）", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const uploaded = await req(mf, "/api/attachments", {
      method: "POST", headers: { "content-type": "image/png", "X-File-Extension": ".png", origin: "http://localhost", cookie }, body: PNG,
    });
    assert.equal(uploaded.status, 201);
    const { sha256 } = await uploaded.json();
    assert.equal(typeof sha256, "string");
    assert.equal(sha256.length, 64);

    const loaded = await req(mf, `/api/attachments/${sha256}`, { headers: { cookie } });
    assert.equal(loaded.status, 200, "读取子路径必须解析会话");
    assert.equal(loaded.headers.get("content-type"), "image/png");
    const bytes = new Uint8Array(await loaded.arrayBuffer());
    assert.deepEqual([...bytes], [...PNG]);

    // 没有会话时仍然是 401（不能为了修裂图把鉴权放开）
    assert.equal((await req(mf, `/api/attachments/${sha256}`)).status, 401);
    // 会话可用但对象不存在 → 404，而不是被鉴权拦成 401
    assert.equal((await req(mf, `/api/attachments/${"0".repeat(64)}`, { headers: { cookie } })).status, 404);
  });
});

test("附件列表游标翻到 500 条之后，保持原有首屏读取", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    await db.prepare(`WITH RECURSIVE n(i) AS (VALUES (1) UNION ALL SELECT i + 1 FROM n WHERE i < 501)
      INSERT INTO attachments (user_id, sha256, size, mime) SELECT ?, printf('%064x', i), 1, 'image/png' FROM n`).bind(user.id).run();
    const first = await (await req(mf, "/api/attachments", { headers: { cookie } })).json();
    assert.equal(first.attachments.length, 500);
    assert.equal(first.nextCursor, first.attachments.at(-1).sha256);
    const last = await (await req(mf, `/api/attachments?cursor=${first.nextCursor}`, { headers: { cookie } })).json();
    assert.deepEqual(last.attachments.map((row) => row.sha256), [(501).toString(16).padStart(64, "0")]);
    assert.equal(last.nextCursor, undefined);
  });
});

test("手动永久删除仅处理仍位于回收站的条目并原子清除包装与附件引用", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const { sha256 } = await (await upload(mf, cookie)).json();
    for (const [id, deletedAt] of [["trash", 10], ["active", null]]) {
      await db.batch([
        db.prepare(`INSERT INTO items
          (id, user_id, type, title, content_markdown, content_hash, tags_json, attachment_hashes_json, source, rev, meta_rev, created_at, updated_at, deleted_at)
          VALUES (?, ?, 'note', '标题', '正文', 'h', '[]', ?, 'manual', 1, 1, 1, 1, ?)`)
          .bind(id, user.id, JSON.stringify([sha256]), deletedAt),
        db.prepare(`INSERT INTO item_key_wraps
          (item_id, user_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, created_at)
          VALUES (?, ?, 'password', X'01', 1, X'01', X'01', 1)`).bind(id, user.id),
        db.prepare(`INSERT INTO item_versions
          (id, item_id, user_id, encrypted, snapshot_plain, codec, reason, created_at)
          VALUES (?, ?, ?, 0, X'01', 'identity', 'manual', 1)`).bind(`version-${id}`, id, user.id),
      ]);
    }
    const response = await json(mf, cookie, "POST", "/api/trash/purge", { ids: ["trash", "active"] });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { purged: 1 });
    for (const table of ["item_key_wraps", "item_versions", "attachment_item_refs"]) {
      assert.deepEqual((await db.prepare(`SELECT item_id FROM ${table}`).all()).results, [{ item_id: "active" }]);
    }
    assert.deepEqual((await db.prepare("SELECT entity_id FROM sync_log WHERE op = 'delete'").all()).results,
      [{ entity_id: "trash" }]);
  });
});

test("附件上传缺少扩展名时被策略拒绝且不写入对象", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const response = await req(mf, "/api/attachments", {
      method: "POST", headers: { "content-type": "image/png", origin: "http://localhost", cookie }, body: PNG,
    });
    assert.equal(response.status, 400);
    const db = await mf.getD1Database("DB");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const sha256 = createHash("sha256").update(PNG).digest("hex");
    assert.equal(await (await mf.getR2Bucket("BUCKET")).head(`${user.id}/${sha256}`), null);
  });
});
