import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { fileURLToPath } from "node:url";

const registryBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/db/migrations/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral", loader: { ".sql": "text" },
});
const { migrations: migrationRegistry } = await import(`data:text/javascript;base64,${Buffer.from(registryBundle.outputFiles[0].text).toString("base64")}`);
const migrationCount = migrationRegistry.length;

const bundle = await build({
  entryPoints: [new URL("./migration-worker.ts", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")],
  bundle: true, write: false, format: "esm", platform: "neutral",
  loader: { ".sql": "text" },
});

async function databaseTest(run) {
  const mf = new Miniflare({
    workers: [{ config: { name: "test", compatibilityDate: "2026-10-30",
      manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
      env: { DB: { type: "d1", id: "test-database" } } } }],
  });
  try { await run(mf, await mf.getD1Database("DB")); } finally { await mf.dispose(); }
}

const request = (mf, path = "/") => mf.dispatchFetch(`http://localhost${path}`);

test("initialization and repeat are idempotent, including concurrent calls", async () => {
  await databaseTest(async (mf, db) => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => request(mf)));
    for (const response of responses) assert.equal(await response.text(), "ready");
    assert.equal(await (await request(mf)).text(), "ready");
    const versions = await db.prepare("SELECT version, name FROM schema_migrations").all();
    assert.deepEqual(versions.results, migrationRegistry.map(({ version, name }) => ({ version, name })));
    const table = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'monitor_samples'").first();
    assert.equal(table.name, "monitor_samples");
  });
});

test("failed upgrade rolls back its schema and version and can be retried", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal((await request(mf, "/fail")).status, 500);
    assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'test_upgrade'").first(), null);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").first()).n, migrationCount);
    assert.equal(await (await request(mf, "/upgrade")).text(), "ready");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").first()).n, migrationCount + 1);
    assert.equal(await (await request(mf)).text(), "incompatible");
  });
});

test("an unknown or altered ledger is never reported ready", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf)).text(), "ready");
    await db.prepare("UPDATE schema_migrations SET name = 'unexpected' WHERE version = 1").run();
    assert.equal(await (await request(mf, "/status")).text(), "incompatible");
    assert.equal(await (await request(mf)).text(), "incompatible");
  });
});


test("a version-1 database upgrades in place and the monitor lookup uses its index", async () => {
  await databaseTest(async (mf, db) => {
    await db.prepare("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY CHECK (version > 0), name TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
    await db.prepare("CREATE TABLE monitor_samples (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, service TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, sampled_at INTEGER NOT NULL)").run();
    await db.prepare("INSERT INTO schema_migrations (version, name) VALUES (1, '0001_monitor_samples')").run();
    await db.prepare("INSERT INTO monitor_samples (user_id, service, metric, value, sampled_at) VALUES ('test', 'workers', 'api_requests', 100, 42)").run();
    assert.equal(await (await request(mf)).text(), "ready");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM monitor_samples").first()).n, 1);
    const plan = await db.prepare("EXPLAIN QUERY PLAN SELECT SUM(value) FROM monitor_samples WHERE user_id = ? AND service = ? AND metric = ? AND sampled_at >= ? AND sampled_at < ?").bind("test", "workers", "api_requests", 0, 100).all();
    assert.ok(plan.results.some((row) => row.detail.includes("monitor_samples_lookup")));
  });
});


test("initial schema rejects cross-user references and plaintext in encrypted records", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf)).text(), "ready");
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('a', 'alice', 'owner', 1), ('b', 'bob', 'member', 1)").run();
    await db.prepare("INSERT INTO topic_nodes (id, user_id, parent_id, name, depth) VALUES ('topic-b', 'b', NULL, 'topic', 0)").run();
    const insert = (id, user, topic, plain, cipher, encrypted, privateSpace, type = "note") =>
      db.prepare(`INSERT INTO items (id,user_id,type,topic_id,title,content_markdown,content_ciphertext,tags_json,attachment_hashes_json,source,rev,meta_rev,content_hash,enc_self,in_enc_space,created_at,updated_at)
        VALUES (?, ?, ?, ?, 'title', ?, ?, '[]', '[]', 'manual', 0, 0, 'hash', ?, ?, 1, 1)`)
        .bind(id, user, type, topic, plain, cipher, encrypted, privateSpace).run();
    await assert.rejects(insert("bad-cross-user", "a", "topic-b", "text", null, 0, 0));
    await assert.rejects(insert("bad-plaintext", "a", null, "text", "opaque", 1, 0));
    await assert.rejects(insert("bad-private-memo", "a", null, null, "opaque", 0, 1, "memo"));
    await insert("plain", "a", null, "text", null, 0, 0);
    await insert("encrypted", "a", null, null, "opaque", 1, 0);
    const rows = await db.prepare("SELECT id, content_markdown, content_ciphertext FROM items ORDER BY id").all();
    assert.deepEqual(rows.results.map((row) => row.id), ["encrypted", "plain"]);
    assert.equal(rows.results[0].content_markdown, null);
  });
});


test("concurrent samples merge into an hourly bucket without losing increments", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf)).text(), "ready");
    const results = await Promise.all(Array.from({ length: 10 }, () => request(mf, "/sample")));
    for (const response of results) assert.equal(await response.text(), "sampled");
    const rows = await db.prepare("SELECT estimate, sample_count FROM monitor_hourly").all();
    assert.equal(rows.results.length, 1);
    assert.equal(rows.results[0].estimate, 1000);
    assert.equal(rows.results[0].sample_count, 10);
    await db.prepare("INSERT INTO monitor_samples (user_id,service,metric,value,sampled_at) VALUES (?, 'workers', 'api_requests', 100, ?)")
      .bind("__m1_installation_test__", 1_800_000_001_000).run();
    const summary = await (await request(mf, "/summary")).json();
    assert.equal(summary.estimatedRequests, 1100);
    assert.equal(summary.sampleCount, 11);
    assert.equal(summary.points.length, 1);
    assert.equal(summary.points[0].estimatedRequests, 1100);
    assert.equal(summary.points[0].sampleCount, 11);
  });
});


test("encrypted items cannot retain or accept plaintext history", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf)).text(), "ready");
    await db.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('a', 'alice', 'owner', 1)").run();
    await db.prepare(`INSERT INTO items (id,user_id,type,title,content_markdown,tags_json,attachment_hashes_json,source,rev,meta_rev,content_hash,created_at,updated_at)
      VALUES ('note','a','note','title','draft','[]','[]','manual',0,0,'hash',1,1)`).run();
    await db.prepare("INSERT INTO item_versions (id,user_id,item_id,encrypted,snapshot_plain,codec,reason,created_at) VALUES ('v1','a','note',0,'draft','identity','test',1)").run();
    await assert.rejects(db.prepare("UPDATE items SET enc_self=1, content_markdown=NULL, content_ciphertext='opaque' WHERE id='note'").run());
    await db.prepare("UPDATE item_versions SET encrypted=1, snapshot_plain=NULL, snapshot_ciphertext='opaque' WHERE id='v1'").run();
    await db.prepare("UPDATE items SET enc_self=1, content_markdown=NULL, content_ciphertext='opaque' WHERE id='note'").run();
    await assert.rejects(db.prepare("UPDATE item_versions SET encrypted=0, snapshot_plain='draft', snapshot_ciphertext=NULL WHERE id='v1'").run());
    await assert.rejects(db.prepare("INSERT INTO item_versions (id,user_id,item_id,encrypted,snapshot_plain,codec,reason,created_at) VALUES ('v2','a','note',0,'draft','identity','test',2)").run());
    await db.prepare("INSERT INTO item_versions (id,user_id,item_id,encrypted,snapshot_ciphertext,codec,reason,created_at) VALUES ('v3','a','note',1,'opaque','identity','test',3)").run();
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM item_versions WHERE snapshot_plain IS NOT NULL").first()).n, 0);
  });
});


test("monitor refuses reads and writes when the schema is newer or renamed", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf)).text(), "ready");
    await request(mf, "/sample");
    assert.equal((await db.prepare("SELECT sample_count FROM monitor_hourly").first()).sample_count, 1);
    await db.prepare(`INSERT INTO schema_migrations (version, name) VALUES (${migrationCount + 1}, 'future')`).run();
    await request(mf, "/sample");
    assert.equal((await db.prepare("SELECT sample_count FROM monitor_hourly").first()).sample_count, 1);
    assert.equal((await request(mf, "/summary")).status, 503);
    await db.prepare("DELETE FROM schema_migrations WHERE version = 18").run();
    await db.prepare("UPDATE schema_migrations SET name = 'altered' WHERE version = 1").run();
    await request(mf, "/sample");
    assert.equal((await db.prepare("SELECT sample_count FROM monitor_hourly").first()).sample_count, 1);
    assert.equal((await request(mf, "/summary")).status, 503);
  });
});


test("trend buckets use UTC period boundaries and never fabricate empty samples", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf)).text(), "ready");
    const now = 1_800_000_001_000;
    const date = new Date(now);
    const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const month = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    for (const timestamp of [now, day - 3600000, month - 3600000]) {
      await db.prepare("INSERT INTO monitor_samples (user_id,service,metric,value,sampled_at) VALUES (?, 'workers', 'api_requests', 100, ?)")
        .bind("__m1_installation_test__", timestamp).run();
    }
    const daily = await (await request(mf, "/summary")).json();
    const monthly = await (await request(mf, "/summary-month")).json();
    assert.equal(daily.estimatedRequests, 100);
    assert.equal(daily.points.length, 1);
    assert.equal(monthly.estimatedRequests, 200);
    assert.equal(monthly.points.length, 2);
    assert.ok(monthly.points.every((point) => point.sampleCount === 1));
  });
});


test("backup target upgrade preserves records without enabling them", async () => {
  await databaseTest(async (mf, db) => {
    assert.equal(await (await request(mf, "/up-to-v15")).text(), "ready");
    await db.prepare("INSERT INTO users (id,username,role,created_at) VALUES ('a','alice','owner',1)").run();
    await db.prepare("INSERT INTO backup_targets (id,user_id,kind,endpoint,secret_ciphertext,delete_policy,schedule) VALUES ('b','a','webdav','https://example.invalid','opaque','append_only','daily')").run();
    assert.equal(await (await request(mf)).text(), "ready");
    const old = await db.prepare("SELECT name, enabled FROM backup_targets WHERE id='b'").first();
    assert.equal(old.name, null);
    assert.equal(old.enabled, 0);
    await db.prepare("UPDATE backup_targets SET name='test target', enabled=1 WHERE id='b'").run();
    const updated = await db.prepare("SELECT name, enabled FROM backup_targets WHERE id='b'").first();
    assert.equal(updated.name, "test target");
    assert.equal(updated.enabled, 1);
    await assert.rejects(db.prepare("UPDATE backup_targets SET enabled=2 WHERE id='b'").run());
  });
});
