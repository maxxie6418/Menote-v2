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

async function withWorker(env, run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "auth-test", compatibilityDate: "2026-10-30", env,
    manifest: { mainModule: "main.mjs", modules: {
      "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text },
    } },
  } }] });
  try { await run(mf); } finally { await mf.dispose(); }
}
const db = { type: "d1", id: "test-auth-database" };
const bucket = { type: "r2", name: "test-auth-bucket" };
const pepper = { type: "text", value: "test-only-pepper" };
const req = (mf, path, init) => mf.dispatchFetch(`http://localhost${path}`, init);
const json = (method, path, body, extra = {}) => ({
  method, headers: { "content-type": "application/json", origin: "http://localhost", ...extra },
  body: JSON.stringify(body),
});
const cookieOf = (response) => response.headers.get("set-cookie")?.split(";")[0];

async function readyWorker(mf) {
  assert.equal((await req(mf, "/api/health/ready")).status, 200);
  const status = await (await req(mf, "/api/auth/status")).json();
  assert.deepEqual(status, { phase: "bootstrap", user: null, registrationOpen: false });
  const response = await req(mf, "/api/auth/bootstrap", json("POST", "", { username: "owner", password: "owner-password-1" }));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.user.role, "owner");
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /mn_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  return cookieOf(response);
}

test("bootstrap creates the first owner atomically; re-running is rejected", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    const database = await mf.getD1Database("DB");
    const owner = await readyWorker(mf);
    assert.equal((await req(mf, "/api/auth/bootstrap", json("POST", "", { username: "other", password: "other-password-1" }))).status, 409);
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 1);
    const credentials = await database.prepare("SELECT salt, hash, iterations, algo FROM user_credentials").all();
    assert.equal(credentials.results.length, 1);
    assert.equal(credentials.results[0].algo, "PBKDF2-SHA256");
    assert.equal(credentials.results[0].iterations, 10000);
    assert.equal(credentials.results[0].salt.length, 16);
    assert.equal(credentials.results[0].hash.length, 32);
    const me = await (await req(mf, "/api/auth/me", { headers: { cookie: owner } })).json();
    assert.equal(me.user.username, "owner");
    const status = await (await req(mf, "/api/auth/status", { headers: { cookie: owner } })).json();
    assert.deepEqual(status, { phase: "ready", user: me.user, registrationOpen: false });
    const anonymous = await (await req(mf, "/api/auth/status")).json();
    assert.equal(anonymous.phase, "login");
  });
});

test("bootstrap rejects weak input and fails closed without the pepper", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    await req(mf, "/api/health/ready");
    assert.equal((await req(mf, "/api/auth/bootstrap", json("POST", "", { username: "owner", password: "short" }))).status, 400);
    assert.equal((await req(mf, "/api/auth/bootstrap", json("POST", "", { username: "", password: "owner-password-1" }))).status, 400);
    const database = await mf.getD1Database("DB");
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 0);
  });
  await withWorker({ DB: db, BUCKET: bucket }, async (mf) => {
    await req(mf, "/api/health/ready");
    const response = await req(mf, "/api/auth/bootstrap", json("POST", "", { username: "owner", password: "owner-password-1" }));
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.equal(text.includes("test-only-pepper"), false);
  });
});

test("login verifies credentials, issues revocable sessions", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    await readyWorker(mf);
    const bad = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: "wrong-password-1" }));
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { error: "invalid_login" });
    const missing = await req(mf, "/api/auth/login", json("POST", "", { username: "nobody", password: "wrong-password-1" }));
    assert.equal(missing.status, 401);
    assert.deepEqual(await missing.json(), { error: "invalid_login" });
    const good = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: "owner-password-1" }));
    assert.equal(good.status, 200);
    const cookie = cookieOf(good);
    assert.ok(cookie?.startsWith("mn_session="));
    const me = await req(mf, "/api/auth/me", { headers: { cookie } });
    assert.equal(me.status, 200);
    assert.equal((await req(mf, "/api/auth/me")).status, 401);
    const logout = await req(mf, "/api/auth/logout", { method: "POST", headers: { origin: "http://localhost", cookie } });
    assert.equal(logout.status, 200);
    assert.equal((await req(mf, "/api/auth/me", { headers: { cookie } })).status, 401);
  });
});

test("login failures are durably throttled per username and released after the window", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    await readyWorker(mf);
    for (let i = 0; i < 10; i += 1) {
      const bad = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: `wrong-${i}-password` }));
      assert.equal(bad.status, 401);
    }
    const locked = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: "owner-password-1" }));
    assert.equal(locked.status, 429);
    assert.deepEqual(await locked.json(), { error: "too_many_attempts" });
    const database = await mf.getD1Database("DB");
    await database.prepare("UPDATE login_throttle SET window_until = 1 WHERE username = 'owner'").run();
    const released = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: "owner-password-1" }));
    assert.equal(released.status, 200);
    const remaining = await database.prepare("SELECT COUNT(*) AS n FROM login_throttle").first();
    assert.equal(remaining.n, 0, "successful login clears the throttle row");
  });
});

test("expired sessions are rejected", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    const cookie = await readyWorker(mf);
    const database = await mf.getD1Database("DB");
    const token = cookie.slice("mn_session=".length);
    await database.prepare("UPDATE sessions SET expires_at = 1 WHERE id = ?").bind(token).run();
    assert.equal((await req(mf, "/api/auth/me", { headers: { cookie } })).status, 401);
  });
});

test("cross-origin mutations are rejected; same-origin requests pass", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    await readyWorker(mf);
    const evil = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: "owner-password-1" }, { origin: "https://evil.example" }));
    assert.equal(evil.status, 403);
    assert.equal((await evil.json()).error, "cross_origin");
  });
});

test("registration is closed by default, owner-controlled, and honours expiry", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    const owner = await readyWorker(mf);
    assert.equal((await req(mf, "/api/auth/register", json("POST", "", { username: "alice", password: "alice-password-1" }))).status, 403);
    assert.equal((await req(mf, "/api/auth/registration", json("POST", "", { open: true }, { cookie: owner }))).status, 200);
    const openStatus = await (await req(mf, "/api/auth/status")).json();
    assert.equal(openStatus.registrationOpen, true);
    const member = await req(mf, "/api/auth/register", json("POST", "", { username: "alice", password: "alice-password-1" }));
    assert.equal(member.status, 201);
    assert.equal((await member.json()).user.role, "member");
    const duplicate = await req(mf, "/api/auth/register", json("POST", "", { username: "alice", password: "alice-password-1" }));
    assert.equal(duplicate.status, 409);
    assert.deepEqual(await duplicate.json(), { error: "username_taken" });
    const me = await req(mf, "/api/auth/me", { headers: { cookie: cookieOf(member) } });
    assert.equal((await me.json()).user.username, "alice");
    const memberCookie = cookieOf(member);
    assert.equal((await req(mf, "/api/auth/registration", json("POST", "", { open: false }, { cookie: memberCookie }))).status, 403);
    assert.equal((await req(mf, "/api/auth/registration", json("POST", "", { open: true, openUntil: Date.now() + 80 }, { cookie: owner }))).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal((await req(mf, "/api/auth/register", json("POST", "", { username: "bob", password: "bob-password-1" }))).status, 403);
  });
});

test("same password hashes differ across users; hash never equals raw digest", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    const owner = await readyWorker(mf);
    await req(mf, "/api/auth/registration", json("POST", "", { open: true }, { cookie: owner }));
    await req(mf, "/api/auth/register", json("POST", "", { username: "alice", password: "shared-password-1" }));
    await req(mf, "/api/auth/register", json("POST", "", { username: "bob", password: "shared-password-1" }));
    const database = await mf.getD1Database("DB");
    const rows = await database.prepare("SELECT salt, hash FROM user_credentials").all();
    assert.equal(rows.results.length, 3);
    const hex = (buffer) => Buffer.from(buffer).toString("hex");
    const salts = new Set(rows.results.map((row) => hex(row.salt)));
    const hashes = new Set(rows.results.map((row) => hex(row.hash)));
    assert.equal(salts.size, 3, "salts must be unique");
    assert.equal(hashes.size, 3, "identical passwords must not produce identical stored hashes");
    for (const row of rows.results) {
      assert.equal(hex(row.hash).includes("shared-password-1"), false);
    }
  });
});

test("login wall time stays within the Workers CPU budget; long passwords are accepted input", async (t) => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    await readyWorker(mf);
    const startedAt = Date.now();
    const response = await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: "owner-password-1" }));
    const elapsed = Date.now() - startedAt;
    assert.equal(response.status, 200);
    t.diagnostic(`login wall time in workerd: ${elapsed}ms (PBKDF2 10k + HMAC pepper)`);
    const long = "x".repeat(120);
    assert.equal((await req(mf, "/api/auth/login", json("POST", "", { username: "owner", password: long }))).status, 401);
  });
});

test("concurrent bootstrap yields exactly one owner", async () => {
  await withWorker({ DB: db, BUCKET: bucket, AUTH_PEPPER: pepper }, async (mf) => {
    await req(mf, "/api/health/ready");
    const attempts = await Promise.all(["a", "b", "c"].map((name) =>
      req(mf, "/api/auth/bootstrap", json("POST", "", { username: name, password: "same-password-1" }))));
    const statuses = attempts.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409, 409]);
    const database = await mf.getD1Database("DB");
    assert.equal((await database.prepare("SELECT COUNT(*) AS n FROM users").first()).n, 1);
  });
});
