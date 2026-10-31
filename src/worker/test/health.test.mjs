import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const bundle0 = await build({
  entryPoints: [fileURLToPath(new URL("../src/db/migrations/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral", loader: { ".sql": "text" },
});
const { migrations: migrationRegistry } = await import(`data:text/javascript;base64,${Buffer.from(bundle0.outputFiles[0].text).toString("base64")}`);
const migrationCount = migrationRegistry.length;

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral", loader: { ".sql": "text" },
});

async function withWorker(env, run) {
  const mf = new Miniflare({ unsafeTriggerHandlers: true, workers: [{ config: {
    name: "health-test", compatibilityDate: "2026-10-30", env,
    triggers: [{ type: "scheduled", schedule: "0 * * * *" }],
    manifest: { mainModule: "main.mjs", modules: {
      "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text },
    } },
  } }] });
  try { await run(mf); } finally { await mf.dispose(); }
}
const db = { type: "d1", id: "test-health-database" };
const bucket = { type: "r2", name: "test-health-bucket" };
const pepper = { type: "text", value: "test-only-pepper" };
const req = (mf, path, init) => mf.dispatchFetch(`http://localhost${path}`, init);

/** G1：创建首个 owner 并返回会话 cookie（mn_session=...）。 */
async function bootstrapOwner(mf, username = "owner", password = "owner-password-1") {
  const response = await req(mf, "/api/auth/bootstrap", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 201, `bootstrap failed: ${response.status}`);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("mn_session="), "session cookie missing");
  return cookie;
}

test("missing secret fails closed and does not initialize D1", async () => {
  await withWorker({ DB: db, BUCKET: bucket }, async (mf) => {
    assert.equal((await req(mf, "/api/health/live")).status, 200);
    const response = await req(mf, "/api/health/ready");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: "unavailable" });
    const database = await mf.getD1Database("DB");
    assert.equal(await database.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").first(), null);
  });
});

test("both resources and secret initialize schema; unknown routes do not expose data", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    const response = await req(mf, "/api/health/ready");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ready" });
    assert.equal((await req(mf, "/api/health/ready", { method: "POST" })).status, 405);
    assert.equal((await req(mf, "/api/other")).status, 404);
    const database = await mf.getD1Database("DB");
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM schema_migrations").first()).n, migrationCount);
  });
});

test("missing D1 or R2 is unavailable without disclosing secret", async () => {
  for (const env of [{ DB: db, AUTH_PEPPER: pepper }, { BUCKET: bucket, AUTH_PEPPER: pepper }]) {
    await withWorker(env, async (mf) => {
      const response = await req(mf, "/api/health/ready");
      assert.equal(response.status, 503);
      assert.equal((await response.text()).includes("test-only-pepper"), false);
    });
  }
});

test("newer schema is not reported as ready", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    assert.equal((await req(mf, "/api/health/ready")).status, 200);
    const database = await mf.getD1Database("DB");
    await database.prepare("INSERT INTO schema_migrations (version, name) VALUES (26, 'future')").run();
    assert.equal((await req(mf, "/api/health/ready")).status, 503);
  });
});


test("monitor distinguishes missing samples and a controlled application estimate", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    assert.equal((await req(mf, "/api/health/ready")).status, 200);
    const cookie = await bootstrapOwner(mf);
    let response = await req(mf, "/api/monitor", { headers: { cookie } });
    let summary = await response.json();
    assert.equal(summary.source, "sampled_application_estimate");
    assert.equal(summary.estimatedRequests, summary.sampleCount === 0 ? null : summary.sampleCount * 100);
    assert.equal(summary.quotaSharedAcrossAccount, true);
    const database = await mf.getD1Database("DB");
    const now = Date.now();
    await database.prepare("INSERT INTO monitor_samples (user_id, service, metric, value, sampled_at) VALUES (?, ?, ?, ?, ?)")
      .bind("__m1_installation_test__", "workers", "api_requests", 100, now).run();
    response = await req(mf, "/api/monitor", { headers: { cookie } });
    summary = await response.json();
    assert.ok(summary.estimatedRequests >= 100);
    assert.ok(summary.sampleCount >= 1);
    assert.equal(summary.quota, 100000);
    assert.equal(summary.period, "utc_day");
    const month = await (await req(mf, "/api/monitor?period=utc_month", { headers: { cookie } })).json();
    assert.equal(month.period, "utc_month");
    assert.ok(month.estimatedRequests >= 100);
    assert.equal((await req(mf, "/api/monitor?period=invalid", { headers: { cookie } })).status, 400);
    assert.equal((await req(mf, "/api/monitor")).status, 401);
  });
});

test("monitor and bootstrap fail closed without the secret", async () => {
  await withWorker({ DB: db, BUCKET: bucket }, async (mf) => {
    assert.equal((await req(mf, "/api/monitor")).status, 401);
    const bootstrap = await req(mf, "/api/auth/bootstrap", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({ username: "owner", password: "owner-password-1" }),
    });
    assert.equal(bootstrap.status, 503);
  });
});


test("failed R2 check does not initialize the database or leak internal errors", async () => {
  await withWorker({ DB: db, BUCKET: { type: "text", value: "not-a-bucket" }, AUTH_PEPPER: pepper }, async (mf) => {
    const response = await req(mf, "/api/health/ready");
    assert.equal(response.status, 503);
    assert.equal(await response.text(), JSON.stringify({ status: "unavailable" }));
    const database = await mf.getD1Database("DB");
    assert.equal(await database.prepare("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'").first(), null);
  });
});

test("migration failure is unavailable and does not expose SQL or internal exceptions", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    const database = await mf.getD1Database("DB");
    await database.prepare("CREATE TABLE monitor_samples (wrong_column TEXT)").run();
    const response = await req(mf, "/api/health/ready");
    assert.equal(response.status, 503);
    assert.equal(await response.text(), JSON.stringify({ status: "unavailable" }));
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM schema_migrations").first()).n, 0);
  });
});


test("scheduled placeholder runs without creating application tables", async () => {
  await withWorker({ DB: db, BUCKET: bucket }, async (mf) => {
    const response = await req(mf, "/cdn-cgi/local/scheduled?cron=0+*+*+*+*");
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    const database = await mf.getD1Database("DB");
    const row = await database.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('schema_migrations','items','monitor_samples')").first();
    assert.equal(row.n, 0);
  });
});
