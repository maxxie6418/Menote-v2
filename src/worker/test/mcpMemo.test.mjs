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

test("TP20 isolates memory permissions, serializes row writes and merges independent browser edits", async () => {
  await withWorker(async (mf) => {
    const cookie = await loginCookie(mf);
    const owner = (path, method = "GET", data) => req(mf, path, { method, headers: { cookie, origin: "http://localhost", "content-type": "application/json" },
      ...(data && { body: JSON.stringify(data) }) });
    assert.deepEqual(await (await owner("/api/memory/status")).json(), { enabled: false, binding: null });
    assert.equal((await owner("/api/memory/enabled", "PUT", { enabled: true })).status, 200);
    const created = await owner("/api/memory/binding/new", "POST");
    assert.equal(created.status, 201);
    const { binding } = await created.json();
    assert.equal(binding.available, true);
    const readWrite = await openMcp(mf, await createTokenSecret(mf, cookie, false, { permissions: ["memory:read", "memory:write"] }));
    const readOnly = await openMcp(mf, await createTokenSecret(mf, cookie, false, { permissions: ["memory:read"] }));
    const list = (client) => client.list().then(parseRpc).then(({ result }) => result.tools.map(({ name }) => name).sort());
    assert.deepEqual(await list(readOnly), ["connection_status", "memory_query"]);
    assert.deepEqual(await list(readWrite), ["connection_status", "memory_create", "memory_query", "memory_update"]);
    const call = (client, name, args) => client.call(name, args).then(parseRpc).then(({ result, error }) => result?.isError ? result.content[0].text : result?.structuredContent ?? error);
    const query = { scope: "project", project_id: "menote" };
    const firstQuery = await call(readOnly, "memory_query", query);
    assert.deepEqual(firstQuery, { binding_id: binding.id, rows: [], next_cursor: null });
    const a = { ...query, binding_id: binding.id, operation_id: crypto.randomUUID(), key: "release.language", title: "发布语言", value: "简体|中文", source: String.raw`仓库规则 A\|B` };
    const b = { ...a, operation_id: crypto.randomUUID(), key: "review.owner", title: "审核人", value: "审核 A" };
    const [first, second] = await Promise.all([call(readWrite, "memory_create", a), call(readWrite, "memory_create", b)]);
    assert.equal(first.row_rev, 1);
    assert.equal(second.row_rev, 1);
    assert.deepEqual(await call(readWrite, "memory_create", a), first);
    assert.equal(await call(readWrite, "memory_create", { ...a, value: "different" }), "operation_conflict");
    assert.equal(await call(readWrite, "memory_create", { ...a, operation_id: crypto.randomUUID() }), "key_exists");
    const page = await call(readOnly, "memory_query", { ...query, key: a.key });
    assert.equal(page.rows[0].value, a.value);
    assert.equal(page.rows[0].source, a.source);

    const pullItem = async () => (await (await owner("/api/sync/pull?cursor=0")).json()).items.find(({ id }) => id === binding.tableId);
    const base = await pullItem();
    async function browserEdit(item, replacements) {
      const original = item.content.markdown;
      const markdown = replacements.reduce((value, [from, to]) => value.replace(from, to), original);
      assert.notEqual(original, markdown);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown));
      const contentHash = Buffer.from(digest).toString("hex");
      const result = await owner("/api/sync/push", "POST", { deviceId: "offline-browser", operations: [{ operationId: crypto.randomUUID(),
        userId: item.userId, entity: "item", entityId: item.id, action: "upsert", baseRev: item.rev, baseMetaRev: item.metaRev, contentHash,
        payload: { item: { ...item, rev: item.rev + 1, contentHash, content: { scope: "plain", markdown } }, memoryBaseMarkdown: original } }] });
      return (await result.json()).results[0];
    }
    const update = { binding_id: binding.id, operation_id: crypto.randomUUID(), id: first.id, expected_row_rev: 1,
      patch: { value: "英文", source: "维护者 B" } };
    assert.equal((await call(readWrite, "memory_update", update)).row_rev, 2);
    assert.equal((await browserEdit(base, [["审核 A", "审核 B"], ["简体\\|中文", "旧浏览器稿"]])).result, "conflict");
    const after = await call(readOnly, "memory_query", query);
    assert.deepEqual(after.rows.map(({ key, value, row_rev }) => [key, value, row_rev]).sort(), [[a.key, "英文", 2], [b.key, "审核 B", 2]]);
    assert.equal(await call(readWrite, "memory_update", { ...update, operation_id: crypto.randomUUID() }), "revision_conflict");
    assert.equal((await call(readWrite, "memory_update", { ...update, expected_row_rev: 2, operation_id: crypto.randomUUID(), patch: { status: "archived" } })).status, "archived");
    assert.deepEqual((await call(readOnly, "memory_query", { ...query, key: a.key })).rows, []);
    assert.equal((await call(readOnly, "memory_query", { ...query, key: a.key, status: "all" })).rows[0].status, "archived");
    assert.equal((await call(readWrite, "memory_update", { ...update, expected_row_rev: 3, operation_id: crypto.randomUUID(), patch: { status: "active" } })).id, first.id);
    assert.equal((await owner("/api/auth/registration", "POST", { open: true, openUntil: Date.now() + 900_000 })).status, 200);
    const secondLogin = await req(mf, "/api/auth/register", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ username: "second-owner", password: "isolated-account-password" }) });
    assert.equal(secondLogin.status, 201);
    const secondCookie = secondLogin.headers.get("set-cookie").split(";")[0];
    const secondOwner = (path, method, data) => req(mf, path, { method, headers: { cookie: secondCookie, origin: "http://localhost", "content-type": "application/json" },
      ...(data && { body: JSON.stringify(data) }) });
    assert.equal((await secondOwner("/api/memory/enabled", "PUT", { enabled: true })).status, 200);
    const otherBinding = (await (await secondOwner("/api/memory/binding/new", "POST")).json()).binding;
    assert.notEqual(otherBinding.id, binding.id);
    const otherAgent = await openMcp(mf, await createTokenSecret(mf, secondCookie, false, { permissions: ["memory:read", "memory:write"] }));
    assert.equal(await call(otherAgent, "memory_query", { ...query, binding_id: binding.id }), "binding_changed");
    assert.equal(await call(otherAgent, "memory_update", { ...update, binding_id: otherBinding.id, operation_id: crypto.randomUUID() }), "not_found");
    assert.equal((await call(otherAgent, "memory_create", { ...a, binding_id: otherBinding.id, value: "第二账号内容" })).row_rev, 1);
    assert.equal((await call(readOnly, "memory_query", { ...query, key: a.key })).rows[0].value, "英文");
    assert.equal((await call(otherAgent, "memory_query", { ...query, key: a.key })).rows[0].value, "第二账号内容");
    await owner("/api/memory/enabled", "PUT", { enabled: false });
    assert.equal(await call(readWrite, "memory_create", a), "memory_unavailable");
    const restored = await (await owner("/api/memory/enabled", "PUT", { enabled: true })).json();
    assert.notEqual(restored.binding.id, binding.id);
    assert.equal(await call(readOnly, "memory_query", { ...query, binding_id: binding.id }), "binding_changed");
    assert.equal((await owner(`/api/memory/binding/${restored.binding.id}`, "DELETE")).status, 200);
    assert.equal(await call(readOnly, "memory_query", query), "memory_unavailable");
    assert.match((await pullItem()).content.markdown, /审核 B/);

    const tableId = crypto.randomUUID();
    const emptyTable = "---\nfields:\n  自定义:\n    type: text\n---\n\n| 自定义 |\n| --- |";
    const checksum = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(emptyTable))).toString("hex");
    const customTable = { ...base, id: tableId, title: "存量表", rev: 1, metaRev: 1, contentHash: checksum, content: { scope: "plain", markdown: emptyTable } };
    const seeded = await owner("/api/sync/push", "POST", { deviceId: "legacy-table", operations: [{ operationId: crypto.randomUUID(),
      userId: base.userId, entity: "item", entityId: tableId, action: "upsert", baseRev: 0, baseMetaRev: 0, contentHash: checksum,
      payload: { item: customTable } }] });
    assert.equal((await seeded.json()).results[0].result, "applied");
    const preview = await (await owner("/api/memory/binding/preview", "POST", { tableId })).json();
    assert.equal(preview.columnsToAdd.length, 11);
    assert.deepEqual(preview.issues, []);
    assert.equal((await owner("/api/memory/binding", "PUT", { tableId, rev: preview.rev })).status, 200);
    const rebound = (await (await owner("/api/sync/pull?cursor=0")).json()).items.find(({ id }) => id === tableId);
    assert.match(rebound.content.markdown, /\| 自定义 \| 范围 \|/);
    const db = await mf.getD1Database("DB");
    await db.prepare("UPDATE items SET deleted_at = ? WHERE id = ?").bind(Date.now(), tableId).run();
    assert.equal(await call(readOnly, "memory_query", query), "memory_unavailable");
    assert.equal((await (await owner("/api/memory/status")).json()).binding.available, false);
  });
});

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
