import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { createToken, listScopeOptions, listTokens, normalizeMcpTokenConfig, revealToken, revokeToken, updateToken } from "../services/mcpTokenManagementService";

const MAX_JSON_BYTES = 128 * 1024;

function getPepper(env: Env): string | null {
  const value: unknown = Reflect.get(env, "AUTH_PEPPER");
  return typeof value === "string" && value.trim() ? value : null;
}

async function readJson(request: Request): Promise<unknown | null> {
  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_JSON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch { return null; }
}

async function schemaReady(env: Env): Promise<boolean> {
  return ensureSchemaReady(env.DB);
}

export const mcpTokenRoutes = new Hono<AppEnv>();
mcpTokenRoutes.use("/api/mcp/tokens/*", resolveSession);
mcpTokenRoutes.use("/api/mcp/tokens", resolveSession);

mcpTokenRoutes.get("/api/mcp/tokens", requireSession, async (c) => {
  if (!(await schemaReady(c.env))) return c.json({ error: "unavailable" }, 503);
  const tokens = await listTokens(c.env.DB, c.get("authUser")!.id);
  return c.json({ tokens }, { headers: { "Cache-Control": "no-store" } });
});

mcpTokenRoutes.get("/api/mcp/tokens/scopes", requireSession, async (c) => {
  if (!(await schemaReady(c.env))) return c.json({ error: "unavailable" }, 503);
  const topics = await listScopeOptions(c.env.DB, c.get("authUser")!.id);
  return c.json({ topics }, { headers: { "Cache-Control": "no-store" } });
});

mcpTokenRoutes.post("/api/mcp/tokens", requireSession, sameOriginGuard, async (c) => {
  const pepper = getPepper(c.env);
  if (!pepper || !(await schemaReady(c.env))) return c.json({ error: "unavailable" }, 503);
  const body = await readJson(c.req.raw);
  if (!body || typeof body !== "object") return c.json({ error: "invalid_request" }, 400);
  const config = (body as { config?: unknown }).config;
  if (config !== undefined && !normalizeMcpTokenConfig(config, Date.now())) return c.json({ error: "invalid_request" }, 400);
  try {
    const created = await createToken(c.env.DB, c.get("authUser")!.id, pepper, config);
    if (!created) return c.json({ error: "invalid_scope" }, 400);
    return c.json({ token: created.token }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});

mcpTokenRoutes.patch("/api/mcp/tokens/:id", requireSession, sameOriginGuard, async (c) => {
  if (!(await schemaReady(c.env))) return c.json({ error: "unavailable" }, 503);
  const body = await readJson(c.req.raw);
  if (!body || typeof body !== "object" || !("config" in body)) return c.json({ error: "invalid_request" }, 400);
  const config = (body as { config: unknown }).config;
  const normalized = normalizeMcpTokenConfig(config, Date.now());
  if (!normalized) return c.json({ error: "invalid_request" }, 400);
  try {
    const updated = await updateToken(c.env.DB, c.get("authUser")!.id, c.req.param("id"), normalized);
    if (updated === null) return c.json({ error: "invalid_scope" }, 400);
    return updated ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});

mcpTokenRoutes.post("/api/mcp/tokens/:id/reveal", requireSession, sameOriginGuard, async (c) => {
  const pepper = getPepper(c.env);
  if (!pepper || !(await schemaReady(c.env))) return c.json({ error: "unavailable" }, 503);
  try {
    const secret = await revealToken(c.env.DB, c.get("authUser")!.id, pepper, c.req.param("id"));
    return secret
      ? c.json({ token: secret }, { headers: { "Cache-Control": "no-store, private" } })
      : c.json({ error: "not_found" }, 404);
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});

mcpTokenRoutes.post("/api/mcp/tokens/:id/revoke", requireSession, sameOriginGuard, async (c) => {
  if (!(await schemaReady(c.env))) return c.json({ error: "unavailable" }, 503);
  try {
    const revoked = await revokeToken(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
    return revoked ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  } catch {
    return c.json({ error: "unavailable" }, 503);
  }
});
