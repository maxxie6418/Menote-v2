import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  conditions: ["worker", "browser"], loader: { ".sql": "text" },
});

async function withWorker(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "mcp-memo-test", compatibilityDate: "2026-10-30",
    env: { DB: { type: "d1", id: "test-mcp-memo-database" }, BUCKET: { type: "r2", name: "test-mcp-memo-bucket" }, AUTH_PEPPER: { type: "text", value: "test-only-pepper" } },
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] });
  try { await run(mf); } finally { await mf.dispose(); }
}
const req = (mf, path, init) => mf.dispatchFetch(`http://localhost${path}`, init);

async function loginCookie(mf) {
  assert.equal((await req(mf, "/api/health/ready")).status, 200);
  const boot = await req(mf, "/api/auth/bootstrap", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
    body: JSON.stringify({ username: "owner", password: "owner-password-1" }),
  });
  assert.equal(boot.status, 201);
  return boot.headers.get("set-cookie").split(";")[0];
}

const tokenConfig = (includeMemos) => ({
  permissions: ["item:create"], scope: { mode: "all", topicIds: [], groupIds: [] },
  includeMemos, allowUrl: false, ratePerMinute: 60, expiresAt: null,
});

/** 建 Token 并走 /reveal 拿回 mn_ 密钥（与设置页「查看并复制」同路径）。 */
async function createTokenSecret(mf, cookie, includeMemos, overrides = {}) {
  const created = await req(mf, "/api/mcp/tokens", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie },
    body: JSON.stringify({ config: { ...tokenConfig(includeMemos), ...overrides }, name: "ext" }),
  });
  assert.equal(created.status, 201);
  const { token } = await created.json();
  const revealed = await req(mf, `/api/mcp/tokens/${token.id}/reveal`, {
    method: "POST", headers: { origin: "http://localhost", cookie },
  });
  assert.equal(revealed.status, 200);
  const { token: secret } = await revealed.json();
  return secret;
}

/** 与扩展客户端同路径：initialize 协商版本，后续 tools/call 带版本与会话头；响应可能是 JSON 或单帧 SSE。 */
function parseRpc(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) return response.json();
  return response.text().then((text) => {
    const data = text.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).pop();
    if (!data) throw new Error("empty_sse_response");
    return JSON.parse(data);
  });
}

async function openMcp(mf, secret, origin = "chrome-extension://menote-test") {
  const init = await req(mf, "/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      ...(origin ? { origin } : {}), authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "menote-test", version: "0.0.0" } },
    }),
  });
  assert.equal(init.status, 200);
  const body = await parseRpc(init);
  assert.ok(body.result?.protocolVersion, "initialize 应返回协商版本");
  const sessionId = init.headers.get("mcp-session-id");
  let id = 1;
  const rpc = (method, params) => req(mf, "/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        ...(origin ? { origin } : {}), authorization: `Bearer ${secret}`,
        "mcp-protocol-version": body.result.protocolVersion,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
  return { call: (name, args) => rpc("tools/call", { name, arguments: args }), list: () => rpc("tools/list", {}) };
}

test("create_memo writes a timeline memo with quote and source line (FR-EXT-2/FR-MCP-4)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const secret = await createTokenSecret(mf, cookie, true);
    const mcp = await openMcp(mf, secret);
    const operationId = crypto.randomUUID();
    const response = await mcp.call("create_memo", {
      schemaVersion: 1, operationId, text: "划选的一句话\n第二行", sourceUrl: "https://example.com/a?b=1", sourceTitle: "示例页面",
    });
    assert.equal(response.status, 200);
    const body = await parseRpc(response);
    assert.equal(body.result.isError, undefined);
    const payload = JSON.parse(body.result.content[0].text);
    assert.equal(payload.result, "applied");
    assert.equal(payload.itemId, operationId);

    // Memo 内容：逐行引用块 + 来源行；时间线条目 source=clipper、type=memo。
    const pull = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    assert.equal(pull.status, 200);
    const page = await pull.json();
    const memo = page.items.find((item) => item.id === operationId);
    assert.ok(memo, "memo 应出现在同步数据里");
    assert.equal(memo.type, "memo");
    assert.equal(memo.source, "clipper");
    assert.equal(memo.title, null);
    assert.equal(memo.content.scope, "plain");
    assert.match(memo.content.markdown, /^> 划选的一句话\n> 第二行\n\n—— \[示例页面\]\(https:\/\/example\.com\/a\?b=1\)$/);

    // 同 operationId 重试幂等收敛为 duplicate。
    const replay = await mcp.call("create_memo", {
      schemaVersion: 1, operationId, text: "划选的一句话\n第二行", sourceUrl: "https://example.com/a?b=1", sourceTitle: "示例页面",
    });
    const replayPayload = JSON.parse((await parseRpc(replay)).result.content[0].text);
    assert.equal(replayPayload.result, "duplicate");
  });
});

test("create_memo without source stores the plain selection; invalid payloads rejected", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const secret = await createTokenSecret(mf, cookie, true);
    const mcp = await openMcp(mf, secret);
    const response = await mcp.call("create_memo", {
      schemaVersion: 1, operationId: crypto.randomUUID(), text: "  纯文字备注  ",
    });
    const payload = JSON.parse((await parseRpc(response)).result.content[0].text);
    assert.equal(payload.result, "applied");
    const pull = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    const memo = (await pull.json()).items.find((item) => item.id === payload.itemId);
    assert.equal(memo.content.markdown, "> 纯文字备注");

    const invalid = await mcp.call("create_memo", {
      schemaVersion: 1, operationId: crypto.randomUUID(), text: "",
    });
    const invalidBody = await parseRpc(invalid);
    assert.equal(invalidBody.result.isError, true);
  });
});

test("create_memo is hidden from tokens without includeMemos or item:create (FR-MCP-2/3)", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const noMemoSecret = await createTokenSecret(mf, cookie, false);
    const mcp = await openMcp(mf, noMemoSecret);
    const hidden = await mcp.call("create_memo", {
      schemaVersion: 1, operationId: crypto.randomUUID(), text: "不应落库",
    });
    assert.equal(hidden.status, 200);
    const hiddenBody = await parseRpc(hidden);
    // 工具未注册时 MCP 层返回 unknown tool 错误，而非执行写入。
    assert.ok(hiddenBody.error || hiddenBody.result?.isError, "未知工具应被拒绝");

    const readOnly = await req(mf, "/api/mcp/tokens", {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie },
      body: JSON.stringify({ config: { ...tokenConfig(true), permissions: [] }, name: "ro" }),
    });
    assert.equal(readOnly.status, 201);
    const { token } = await readOnly.json();
    const revealed = await req(mf, `/api/mcp/tokens/${token.id}/reveal`, {
      method: "POST", headers: { origin: "http://localhost", cookie },
    });
    const roSecret = (await revealed.json()).token;
    const denied = await mcp.call("create_memo", {
      schemaVersion: 1, operationId: crypto.randomUUID(), text: "不应落库",
    });
    const deniedBody = await parseRpc(denied);
    assert.ok(deniedBody.error || deniedBody.result?.isError, "无创建权限应被拒绝");

    const pull = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    assert.equal((await pull.json()).items.filter((item) => item.type === "memo" && item.content.markdown.includes("不应落库")).length, 0);
  });
});

test("Agent reads apply scope and encryption on every call, including after token changes", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const db = await mf.getD1Database("DB");
    const { id: userId } = await db.prepare("SELECT id FROM users").first();
    await db.prepare(`INSERT INTO topic_nodes (id, user_id, parent_id, name, depth, is_enc_space)
      VALUES ('t', ?1, NULL, 'Visible topic', 0, 0), ('g', ?1, 't', 'Allowed group', 1, 0),
        ('g-other', ?1, 't', 'Other group', 1, 0), ('p', ?1, NULL, 'Hidden space', 0, 1)`).bind(userId).run();
    const add = (id, topic, group, title, flags = {}) => db.prepare(`INSERT INTO items
      (id, user_id, type, topic_id, group_id, title, content_markdown, content_ciphertext, tags_json, attachment_hashes_json,
       source, rev, meta_rev, content_hash, created_at, updated_at, deleted_at, enc_self, in_enc_space)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '["hidden-tag"]', '[]', 'web', 1, 1, 'hash', 1, 1, ?, ?, ?)`)
      .bind(id, userId, flags.memo ? "memo" : "note", topic, group, title,
        flags.sealed || flags.private ? null : "甲😀乙 secret keyword", flags.sealed || flags.private ? "sealed-data" : null,
        flags.deleted ? 1 : null, flags.sealed ? 1 : 0, flags.private ? 1 : 0);
    await db.batch([
      add("a", "t", "g", "Plain note"),
      add("b", "t", "g", "Encrypted keyword", { sealed: true }),
      add("c", "p", null, "Private keyword", { private: true }),
      add("d", "t", "g-other", "Out of scope keyword"),
      add("e", "t", "g", "Deleted keyword", { deleted: true }),
      add("f", "t", "g", null, { memo: true }),
    ]);
    const scope = { mode: "selected", topicIds: [], groupIds: ["g"] };
    const secret = await createTokenSecret(mf, cookie, false, { permissions: ["content:read"], scope });
    const mcp = await openMcp(mf, secret, null);
    const call = async (name, args) => (await parseRpc(await mcp.call(name, args))).result;
    const tools = (await parseRpc(await mcp.list())).result.tools.map((tool) => tool.name);
    assert.ok(tools.includes("search") && tools.includes("read_item") && !tools.includes("create_item"));
    const first = (await call("search", { query: "keyword", limit: 1 })).structuredContent;
    assert.deepEqual(first.rows.map(({ id }) => id), ["a"]);
    const second = (await call("search", { query: "keyword", cursor: first.next_cursor })).structuredContent;
    assert.deepEqual(second.rows, [{ id: "b", title: "Encrypted keyword", encrypted: true }]);
    const folders = (await call("list_folders", {})).structuredContent.rows;
    assert.deepEqual(folders.map(({ id, item_count }) => [id, item_count]), [["g", 1], ["t", 1]]);
    assert.deepEqual((await call("list_items", { tag: "hidden-tag" })).structuredContent.rows.map(({ id }) => id), ["a"]);
    for (const id of ["c", "d", "e", "f"]) assert.equal((await call("read_item", { id })).isError, true);
    assert.equal((await call("list_versions", { id: "b" })).isError, true);
    await db.prepare(`INSERT INTO item_versions (id, user_id, item_id, encrypted, snapshot_plain, codec, reason, created_at)
      VALUES ('snapshot', ?, 'a', 0, ?, 'gzip', 'session', 1)`)
      .bind(userId, Uint8Array.from(gzipSync("旧版本"))).run();
    assert.equal((await call("list_versions", { id: "a" })).structuredContent.rows[0].id, "snapshot");
    assert.equal((await call("read_item", { id: "a", version_id: "snapshot" })).structuredContent.content, "旧版本");
    assert.equal((await call("read_item", { id: "b", version_id: "snapshot" })).isError, true);
    const read = (await call("read_item", { id: "a", max_chars: 2 })).structuredContent;
    assert.equal(read.content, "甲😀");
    assert.equal((await call("read_item", { id: "a", cursor: read.next_cursor })).structuredContent.content, "乙 secret keyword");
    await db.prepare("UPDATE items SET rev = 2 WHERE id = 'a'").run();
    assert.equal((await call("read_item", { id: "a", cursor: read.next_cursor })).content[0].text, "item_changed");
    const { id: tokenId } = await db.prepare("SELECT id FROM mcp_tokens").first();
    const changed = await req(mf, `/api/mcp/tokens/${tokenId}`, { method: "PATCH",
      headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ config: { ...tokenConfig(false), permissions: [], scope }, name: "read" }) });
    assert.equal(changed.status, 200);
    const remaining = (await parseRpc(await mcp.list())).result.tools.map((tool) => tool.name);
    assert.deepEqual(remaining, ["connection_status"]);
  });
});

test("Agent creation is idempotent under concurrent retry and uses the Agent source", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const secret = await createTokenSecret(mf, cookie, true);
    const mcp = await openMcp(mf, secret, null);
    const operationId = crypto.randomUUID();
    const args = { type: "note", title: "Agent note", content: "Source belongs to agent", operation_id: operationId };
    const results = await Promise.all([mcp.call("create_item", args), mcp.call("create_item", args)]);
    const outcomes = await Promise.all(results.map(async (res) => (await parseRpc(res)).result.structuredContent?.result));
    assert.deepEqual(outcomes.sort(), ["applied", "duplicate"]);
    const notes = (await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json()).items;
    assert.equal(notes.length, 1);
    assert.equal(notes[0].source, "agent");
    assert.equal(notes[0].topicId, null);
  });
});

test("clip_page saves tags, notes, and more than 50 token-owned attachments", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const secret = await createTokenSecret(mf, cookie, false, { permissions: ["item:create", "attachment:access"], ratePerMinute: 200 });
    const mcp = await openMcp(mf, secret);
    const hashes = [];
    for (let index = 0; index < 55; index++) {
      const upload = await mcp.call("upload_attachment", { name: `image-${index}.png`, mime: "image/png",
        base64: Buffer.from(`image-fixture-${index}`).toString("base64") });
      const answer = (await parseRpc(upload)).result;
      assert.ok(!answer.isError, JSON.stringify(answer));
      hashes.push(answer.structuredContent.sha256);
    }
    const schema = (await parseRpc(await mcp.list())).result.tools.find((tool) => tool.name === "clip_page").inputSchema;
    assert.equal(schema.properties.attachmentHashes.maxItems, 150);
    const clip = await mcp.call("clip_page", {
      schemaVersion: 1, operationId: crypto.randomUUID(), title: "Many images",
      markdown: hashes.map((sha) => `![](attachments/${sha}--image.png)`).join("\n"),
      attachmentHashes: hashes, tags: ["示例"], note: "测试备注",
      sourceUrl: "https://example.test/article", capturedAt: new Date().toISOString(),
    });
    const answer = (await parseRpc(clip)).result;
    assert.equal(answer.structuredContent?.result, "applied", JSON.stringify(answer));
    const pull = await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } });
    const note = (await pull.json()).items.find((item) => item.id === answer.structuredContent.itemId);
    assert.equal(note.attachmentHashes.length, 55);
    assert.deepEqual(note.tags, ["示例"]);
    assert.match(note.content.markdown, /clip_note: "测试备注"/);
  });
});

test("bookmark replays recheck visibility and never duplicate the line", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const creator = await openMcp(mf, await createTokenSecret(mf, cookie, false), null);
    const target = crypto.randomUUID();
    await creator.call("create_item", { type: "note", operation_id: target, title: "Bookmarks", content: "Intro" });
    const token = await createTokenSecret(mf, cookie, false, { permissions: ["bookmark:write"] });
    const bookmark = await openMcp(mf, token);
    const args = { schemaVersion: 1, operationId: crypto.randomUUID(), targetItemId: target,
      title: "Example", link: "https://example.test/bookmark", tags: [], type: "link",
      capturedAt: new Date().toISOString(), important: false };
    const call = async () => (await parseRpc(await bookmark.call("append_bookmark", args))).result;
    assert.equal((await call()).structuredContent?.result, "applied");
    assert.equal((await call()).structuredContent?.result, "duplicate");
    const db = await mf.getD1Database("DB");
    const item = await db.prepare("SELECT rev, content_markdown FROM items WHERE id = ?").bind(target).first();
    assert.equal(item.rev, 2);
    assert.equal(item.content_markdown.match(/example\.test\/bookmark/g)?.length, 1);
    await db.prepare("UPDATE items SET deleted_at = 123 WHERE id = ?").bind(target).run();
    assert.equal((await call()).content[0].text, "bookmark_target_unavailable");
  });
});
