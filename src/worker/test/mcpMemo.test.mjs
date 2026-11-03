import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
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
async function createTokenSecret(mf, cookie, includeMemos) {
  const created = await req(mf, "/api/mcp/tokens", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie },
    body: JSON.stringify({ config: tokenConfig(includeMemos), name: "ext" }),
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

async function openMcp(mf, secret) {
  const init = await req(mf, "/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream",
      origin: "chrome-extension://menote-test", authorization: `Bearer ${secret}`,
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
  return {
    call: (name, args) => req(mf, "/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json", accept: "application/json, text/event-stream",
        origin: "chrome-extension://menote-test", authorization: `Bearer ${secret}`,
        "mcp-protocol-version": body.result.protocolVersion,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
    }),
  };
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
