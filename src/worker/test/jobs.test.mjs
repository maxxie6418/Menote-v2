import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

// 调度器是纯编排（无 fetch 路由），直接对 Miniflare D1 单元测试。
const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/jobs/scheduled.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
});
const scheduler = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

async function withDatabase(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "jobs-test", compatibilityDate: "2026-10-30",
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: "export default {}" } } },
    env: { DB: { type: "d1", id: "test-jobs-database" } },
  } }] });
  try {
    const db = await mf.getD1Database("DB");
    // D1 exec 对多行 SQL 的切分不可靠，按分号逐语句执行。
    const ddl = await readFile(fileURLToPath(new URL("../src/db/migrations/0022_job_runs.sql", import.meta.url)), "utf8");
    for (const statement of ddl.split(";").map((part) => part.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
    await run(db);
  } finally { await mf.dispose(); }
}
const ctx = { waitUntil() {} };
const job = (name, impl, enabled = true) => ({ name, description: name, enabled, run: impl });
const runs = async (db) => (await db.prepare("SELECT name, status, detail FROM job_runs ORDER BY id").all()).results;

test("disabled jobs are skipped and leave no records", async () => {
  await withDatabase(async (db) => {
    const env = { DB: db };
    await scheduler.dispatchScheduled(env, ctx, Date.now(), [job("disabled_one", () => { throw new Error("must not run"); }, false)]);
    assert.deepEqual(await runs(db), []);
  });
});

test("enabled jobs record ok runs with timing", async () => {
  await withDatabase(async (db) => {
    const env = { DB: db };
    await scheduler.dispatchScheduled(env, ctx, Date.now(), [job("backup_push", () => {})]);
    const rows = await runs(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, "backup_push");
    assert.equal(rows[0].status, "ok");
    assert.equal(rows[0].detail, null);
  });
});

test("a failing job is recorded as failed without blocking the next job", async () => {
  await withDatabase(async (db) => {
    const env = { DB: db };
    const executed = [];
    await scheduler.dispatchScheduled(env, ctx, Date.now(), [
      job("first", () => { executed.push("first"); throw new Error("boom: detail kept"); }),
      job("second", () => { executed.push("second"); }),
    ]);
    assert.deepEqual(executed, ["first", "second"]);
    const rows = await runs(db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "failed");
    assert.match(rows[0].detail, /boom: detail kept/);
    assert.equal(rows[1].status, "ok");
  });
});

test("dispatch without a database binding is a no-op", async () => {
  await scheduler.dispatchScheduled({}, ctx, Date.now(), [job("anything", () => { throw new Error("must not run"); })]);
});

test("recording a run whose table is missing does not throw out of dispatch", async () => {
  const mf = new Miniflare({ workers: [{ config: {
    name: "jobs-raw", compatibilityDate: "2026-10-30",
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: "export default {}" } } },
    env: { DB: { type: "d1", id: "test-jobs-raw" } },
  } }] });
  try {
    const db = await mf.getD1Database("DB");
    await scheduler.dispatchScheduled({ DB: db }, ctx, Date.now(), [job("no_table", () => {})]);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'job_runs'").first()).n, 0);
  } finally { await mf.dispose(); }
});
