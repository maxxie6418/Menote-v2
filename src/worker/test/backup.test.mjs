import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral", loader: { ".sql": "text" },
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
    assert.deepEqual(await response.json(), { ok: true, items: 1, topics: 1 });
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.items.find((item) => item.id === "ri1").title, "恢复的笔记");
    assert.equal(page.topics.find((topic) => topic.id === "t1").name, "恢复主题");
  });
});
