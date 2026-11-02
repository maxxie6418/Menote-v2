import { test } from "node:test";
import assert from "node:assert/strict";
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

test("附件上传后可用会话读回（图片不再 401）", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const uploaded = await req(mf, "/api/attachments", {
      method: "POST", headers: { "content-type": "image/png", origin: "http://localhost", cookie }, body: PNG,
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
