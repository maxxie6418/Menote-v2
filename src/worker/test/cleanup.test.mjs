import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/jobs/scheduled.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  // 打包目标其实是 workerd/浏览器：不补条件时 @modelcontextprotocol/server 会解析到 node shim（node:process），
  // 整个 worker 入口打不出来，这批集成测试会集体失败。
  conditions: ["worker", "browser"],
});
const scheduler = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const cleanup = await import(`data:text/javascript;base64,${Buffer.from(
  (await build({ entryPoints: [fileURLToPath(new URL("../src/db/cleanup.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "neutral" })).outputFiles[0].text,
).toString("base64")}`);

const DAY = 86_400_000;
const now = Date.now();

async function withDatabase(run, seedBeforeLifecycle = async () => {}) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "cleanup-test", compatibilityDate: "2026-10-30",
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: "export default {}" } } },
    env: { DB: { type: "d1", id: "test-cleanup-db" }, BUCKET: { type: "r2", name: "test-cleanup-bucket" } },
  } }] });
  try {
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    // 基础表按外键依赖顺序建立（users → topics → items → attachments → item_versions），再跑带 ALTER 的迁移
    for (const file of ["0003_users.sql", "0004_topics.sql", "0005_items.sql", "0006_attachments.sql", "0008_item_versions.sql", "0015_user_settings.sql", "0022_job_runs.sql", "0023_sync_engine.sql", "0024_key_wraps.sql", "0035_ai.sql", "0040_attachment_object_lifecycle.sql"]) {
      if (file === "0040_attachment_object_lifecycle.sql") await seedBeforeLifecycle(db, bucket);
      const ddl = await (await import("node:fs/promises")).readFile(fileURLToPath(new URL(`../src/db/migrations/${file}`, import.meta.url)), "utf8");
      await db.prepare(ddl).run();
    }
    await run(db, bucket);
  } finally { await mf.dispose(); }
}
const ctx = { waitUntil() {} };

test("迁移旧附件时保留 R2 键，按包括回收站的实际引用重新确定观察起点", async () => {
  await withDatabase(async (db) => {
    const old = await db.prepare("SELECT sha256, r2_key, orphaned_at FROM attachments ORDER BY sha256").all();
    assert.deepEqual(old.results.map((row) => [row.sha256, row.r2_key]), [
      ["old-orphan", "u1/old-orphan"], ["trash-file", "u1/trash-file"],
    ]);
    assert.ok(old.results[0].orphaned_at > now - DAY);
    assert.equal(old.results[1].orphaned_at, null);
    assert.deepEqual((await db.prepare("SELECT sha256, item_id FROM attachment_item_refs").all()).results,
      [{ sha256: "trash-file", item_id: "trash" }]);
  }, async (db) => {
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'owner', 'owner', 1)").run();
    await db.prepare(`INSERT INTO attachments (user_id,sha256,size,mime,ref_count,orphaned_at)
      VALUES ('u1','old-orphan',12,'text/plain',0,?),('u1','trash-file',12,'text/plain',0,?)`).bind(now - 60 * DAY, now - 60 * DAY).run();
    await db.prepare(`INSERT INTO items (id,user_id,type,title,content_markdown,tags_json,attachment_hashes_json,source,rev,meta_rev,content_hash,created_at,updated_at,deleted_at)
      VALUES ('trash','u1','note','回收站','x','[]','["trash-file"]','manual',1,1,'h',1,1,?)`).bind(now - 60 * DAY).run();
  });
});

test("cleanup 物理清理到期孤儿附件，同时清除过期条目和日志", async () => {
  await withDatabase(async (db, bucket) => {
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'owner', 'owner', 1)").run();
    // 孤儿附件：归零且 orphaned_at 超 30 天 → 真删；未到期的保留
    await bucket.put("u1/orphan1", "data1");
    await bucket.put("u1/keep1", "data2");
    await db.prepare("INSERT INTO attachments (user_id, sha256, size, mime, ref_count, orphaned_at, r2_key) VALUES ('u1', 'orphan1', 5, 'text/plain', 0, ?, 'u1/orphan1')").bind(now - 31 * DAY).run();
    await db.prepare("INSERT INTO attachments (user_id, sha256, size, mime, ref_count, orphaned_at, r2_key) VALUES ('u1', 'keep1', 5, 'text/plain', 0, ?, 'u1/keep1')").bind(now - 5 * DAY).run();
    // 软删超 90 天 → 清；正常软删保留
    await db.prepare(`INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at, deleted_at)
      VALUES ('gone', 'u1', 'note', '旧', 'x', '[]', '[]', 'manual', 1, 1, 'h', 1, 1, ?)`).bind(now - 91 * DAY).run();
    await db.prepare(`INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at, deleted_at)
      VALUES ('fresh', 'u1', 'note', '新', 'x', '[]', '[]', 'manual', 1, 1, 'h', 1, 1, ?)`).bind(now - 10 * DAY).run();
    // sync_log / job_runs 保留期
    await db.prepare("INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at) VALUES ('u1', 'item', 'gone', 'upsert', 1, 1, ?)").bind(now - 91 * DAY).run();
    await db.prepare("INSERT INTO job_runs (name, started_at, finished_at, status) VALUES ('cleanup', ?, ?, 'ok')").bind(now - 91 * DAY, now - 91 * DAY).run();

    const cleanupJob = scheduler.scheduledJobs.find((job) => job.name === "cleanup");
    assert.equal(cleanupJob.enabled, true);
    await cleanupJob.run({ DB: db, BUCKET: bucket }, ctx, now);

    assert.equal(await bucket.get("u1/orphan1"), null, "到期孤儿对象已物理清除");
    assert.notEqual(await bucket.get("u1/keep1"), null, "观察期内附件保留");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE sha256 = 'orphan1' AND retired_at IS NULL").first()).n, 0);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'gone'").first().then((row) => row.n), 0, "超期软删本体清除");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'fresh'").first()).n, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sync_log").first()).n, 0, "超期日志清除");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE started_at <= ?").bind(now - 90 * DAY).first()).n, 0);
  });
});

test("共享附件保留到最后一条回收站引用移除，再开始完整观察期", async () => {
  await withDatabase(async (db, bucket) => {
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'owner', 'owner', 1)").run();
    await bucket.put("u1/trash-file", "data");
    await db.prepare("INSERT INTO attachments (user_id, sha256, size, mime, ref_count, orphaned_at, r2_key) VALUES ('u1', 'trash-file', 4, 'text/plain', 0, ?, 'u1/trash-file')").bind(now - 60 * DAY).run();
    await db.prepare(`INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at, deleted_at)
      VALUES ('trash', 'u1', 'note', '回收站', 'x', '[]', '["trash-file"]', 'manual', 1, 1, 'h', 1, 1, ?)`).bind(now - 60 * DAY).run();
    await db.prepare(`INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at)
      VALUES ('shared', 'u1', 'note', '共用', 'x', '[]', '["trash-file"]', 'manual', 1, 1, 'h', 1, 1)`).run();
    await db.prepare(`UPDATE items SET attachment_hashes_json = '[]' WHERE id = 'shared'`).run();
    assert.equal((await db.prepare("SELECT orphaned_at FROM attachments WHERE sha256 = 'trash-file'").first()).orphaned_at, null);
    // 即使计时字段漂移，实时引用检查仍保护回收站中的对象。
    await db.prepare("UPDATE attachments SET orphaned_at = ? WHERE sha256 = 'trash-file'").bind(now - 60 * DAY).run();
    const cleanupJob = scheduler.scheduledJobs.find((job) => job.name === "cleanup");
    await cleanupJob.run({ DB: db, BUCKET: bucket }, ctx, now);
    assert.notEqual(await bucket.get("u1/trash-file"), null);
    await db.prepare("DELETE FROM items WHERE id = 'trash'").run();
    const { orphaned_at: start } = await db.prepare("SELECT orphaned_at FROM attachments WHERE sha256 = 'trash-file'").first();
    assert.ok(start > now - DAY);
    await cleanupJob.run({ DB: db, BUCKET: bucket }, ctx, start + 29 * DAY);
    assert.notEqual(await bucket.get("u1/trash-file"), null);
    await cleanupJob.run({ DB: db, BUCKET: bucket }, ctx, start + 30 * DAY);
    assert.equal(await bucket.get("u1/trash-file"), null);
  });
});

test("过期回收站候选在硬删前已恢复时，保留文章与附件引用", async () => {
  await withDatabase(async (db) => {
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'owner', 'owner', 1)").run();
    await db.prepare(`INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at, deleted_at)
      VALUES ('restored', 'u1', 'note', '已恢复', 'x', '[]', '["trash-file"]', 'manual', 1, 1, 'h', 1, 1, ?)`).bind(now - 91 * DAY).run();
    const cutoff = now - 90 * DAY;
    const expired = await cleanup.listExpiredSoftDeleted(db, "u1", cutoff);
    assert.deepEqual(expired, ["restored"]);
    await db.prepare("UPDATE items SET deleted_at = NULL WHERE id = 'restored'").run();
    await cleanup.purgeItemsWithWraps(db, "u1", expired, cutoff);
    assert.deepEqual(await db.prepare("SELECT deleted_at FROM items WHERE id = 'restored'").first(), { deleted_at: null });
    assert.equal((await db.prepare("SELECT sha256 FROM attachment_item_refs WHERE item_id = 'restored'").first()).sha256, "trash-file");
  });
});
