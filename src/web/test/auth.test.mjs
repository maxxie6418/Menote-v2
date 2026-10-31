import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// 与既有 web 测试同模式：esbuild 打包后经 data URL 加载；网络用可注入的 fetch 假体。
const featureBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/features/auth/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const auth = await import(`data:text/javascript;base64,${Buffer.from(featureBundle.outputFiles[0].text).toString("base64")}`);

const serviceBundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/authService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const service = await import(`data:text/javascript;base64,${Buffer.from(serviceBundle.outputFiles[0].text).toString("base64")}`);

const sharedBundle = await build({
  entryPoints: [fileURLToPath(new URL("../../shared/src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const shared = await import(`data:text/javascript;base64,${Buffer.from(sharedBundle.outputFiles[0].text).toString("base64")}`);

test("auth error codes map to actionable Chinese messages", () => {
  assert.match(auth.authErrorText("invalid_login"), /用户名或口令不正确/);
  assert.match(auth.authErrorText("bootstrap_closed"), /初始化已完成/);
  assert.match(auth.authErrorText("registration_closed"), /未开放注册/);
  assert.match(auth.authErrorText("too_many_attempts"), /稍后再试/);
  assert.match(auth.authErrorText("network"), /网络/);
  assert.notEqual(auth.authErrorText("http_418"), auth.authErrorText("invalid_login"));
  assert.notEqual(auth.authErrorText("mystery_code"), "");
});

test("credential validation comes from shared and covers the documented bounds", () => {
  assert.equal(shared.validUsername("owner"), true);
  assert.equal(shared.validUsername(""), false);
  assert.equal(shared.validUsername(" x"), false);
  assert.equal(shared.validUsername("x".repeat(33)), false);
  assert.equal(shared.validPassword("short"), false);
  assert.equal(shared.validPassword("x".repeat(129)), false);
  assert.equal(shared.validPassword("owner-password-1"), true);
});

test("submitCredentials rejects bad input without touching the network", async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return new Response("{}", { status: 200 });
  };
  try {
    const bad = await service.submitCredentials("/api/auth/login", { username: "", password: "short" });
    assert.deepEqual(bad, { ok: false, code: "invalid_credentials" });
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("submitCredentials maps server success and error responses", async () => {
  const responses = [
    () => new Response(JSON.stringify({ user: { id: "u1", username: "owner", role: "owner" } }), { status: 201 }),
    () => new Response(JSON.stringify({ error: "invalid_login" }), { status: 401 }),
    () => new Response("boom", { status: 503 }),
  ];
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => responses[index++]();
  try {
    const good = await service.submitCredentials("/api/auth/bootstrap", { username: "owner", password: "owner-password-1" });
    assert.deepEqual(good, { ok: true, user: { id: "u1", username: "owner", role: "owner" } });
    const bad = await service.submitCredentials("/api/auth/login", { username: "owner", password: "wrong-password-1" });
    assert.deepEqual(bad, { ok: false, code: "invalid_login" });
    const unavailable = await service.submitCredentials("/api/auth/login", { username: "owner", password: "owner-password-1" });
    assert.deepEqual(unavailable, { ok: false, code: "http_503" });
  } finally {
    globalThis.fetch = original;
  }
});

test("submitCredentials survives a network failure", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("network down"); };
  try {
    const result = await service.submitCredentials("/api/auth/login", { username: "owner", password: "owner-password-1" });
    assert.deepEqual(result, { ok: false, code: "network" });
  } finally {
    globalThis.fetch = original;
  }
});

test("auth status responses are validated before use", async () => {
  const payloads = [
    [{ phase: "bootstrap", user: null, registrationOpen: false }, true],
    [{ phase: "ready", user: { id: "u1", username: "owner", role: "owner" }, registrationOpen: false }, true],
    [{ phase: "ready", user: null, registrationOpen: false }, false],
    [{ phase: "middle", user: null, registrationOpen: false }, false],
    ["not-an-object", false],
  ];
  let index = 0;
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(payloads[index][0]), { status: 200 });
  try {
    for (const [, valid] of payloads) {
      const result = await service.fetchAuthStatus(new AbortController().signal);
      assert.equal(result !== "unavailable", valid, JSON.stringify(payloads[index][0]));
      index += 1;
    }
  } finally {
    globalThis.fetch = original;
  }
});
