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

async function withDatabase(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "cleanup-test", compatibilityDate: "2026-10-30",
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: "export default {}" } } },
    env: { DB: { type: "d1", id: "test-cleanup-db" }, BUCKET: { type: "r2", name: "test-cleanup-bucket" } },
  } }] });
  try {
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    // 基础表按外键依赖顺序建立（users → topics → items → attachments → item_versions），再跑带 ALTER 的迁移
    for (const file of ["0003_users.sql", "0004_topics.sql", "0005_items.sql", "0006_attachments.sql", "0008_item_versions.sql", "0015_user_settings.sql", "0022_job_runs.sql", "0023_sync_engine.sql", "0024_key_wraps.sql", "0035_ai.sql"]) {
      const ddl = await (await import("node:fs/promises")).readFile(fileURLToPath(new URL(`../src/db/migrations/${file}`, import.meta.url)), "utf8");
      for (const statement of ddl.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    await run(db, bucket);
  } finally { await mf.dispose(); }
}
const ctx = { waitUntil() {} };

test("cleanup purges expired orphans, soft-deleted items, logs and run records (G10)", async () => {
  await withDatabase(async (db, bucket) => {
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('u1', 'owner', 'owner', 1)").run();
    // 孤儿附件：归零且 orphaned_at 超 30 天 → 真删；未到期的保留
    await bucket.put("u1/orphan1", "data1");
    await bucket.put("u1/keep1", "data2");
    await db.prepare("INSERT INTO attachments (user_id, sha256, size, mime, ref_count, orphaned_at) VALUES ('u1', 'orphan1', 5, 'text/plain', 0, ?)").bind(now - 31 * DAY).run();
    await db.prepare("INSERT INTO attachments (user_id, sha256, size, mime, ref_count, orphaned_at) VALUES ('u1', 'keep1', 5, 'text/plain', 0, ?)").bind(now - 5 * DAY).run();
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

    assert.equal(await bucket.get("u1/orphan1"), null, "孤儿对象已真删");
    assert.notEqual(await bucket.get("u1/keep1"), null, "观察期内附件保留");
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM attachments WHERE sha256 = 'orphan1'").first().then((row) => row.n), 0);
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'gone'").first().then((row) => row.n), 0, "超期软删本体清除");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM items WHERE id = 'fresh'").first()).n, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sync_log").first()).n, 0, "超期日志清除");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM job_runs WHERE started_at <= ?").bind(now - 90 * DAY).first()).n, 0);
  });
});
