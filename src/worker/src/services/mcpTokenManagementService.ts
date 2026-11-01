import { MCP_PERMISSION_KEYS, type McpPermission, type McpToken, type McpTokenConfig, type McpTokenScope, type McpTokenView } from "@menote/shared";
import {
  findMcpTokenByHash, getMcpToken, insertMcpToken, listMcpScopeNodes, listMcpTokens,
  revokeMcpToken, touchMcpToken, updateMcpTokenConfig,
} from "../db/mcpTokens";
import { generateMcpToken, hashMcpToken, openMcpToken, sealMcpToken } from "./mcpTokenCrypto";

const DEFAULT_CONFIG: McpTokenConfig = {
  permissions: [], scope: { mode: "all", topicIds: [], groupIds: [] },
  includeMemos: false, allowUrl: false, ratePerMinute: 60, expiresAt: null,
};

function isPermission(value: unknown): value is McpPermission {
  return typeof value === "string" && MCP_PERMISSION_KEYS.some((permission) => permission === value);
}

function normalizeIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 500 || value.some((id) => typeof id !== "string" || id.length < 1 || id.length > 128)) return null;
  return [...new Set(value as string[])];
}

export function normalizeMcpTokenConfig(value: unknown, now: number): McpTokenConfig | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.permissions) || input.permissions.some((permission) => !isPermission(permission))) return null;
  if (typeof input.includeMemos !== "boolean" || typeof input.allowUrl !== "boolean") return null;
  if (typeof input.ratePerMinute !== "number" || !Number.isInteger(input.ratePerMinute) || input.ratePerMinute < 1 || input.ratePerMinute > 10_000) return null;
  if (input.expiresAt !== null && (typeof input.expiresAt !== "number" || !Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now)) return null;
  const scopeValue = input.scope;
  if (!scopeValue || typeof scopeValue !== "object") return null;
  const scopeInput = scopeValue as Record<string, unknown>;
  if (scopeInput.mode !== "all" && scopeInput.mode !== "selected") return null;
  const topicIds = normalizeIds(scopeInput.topicIds);
  const groupIds = normalizeIds(scopeInput.groupIds);
  if (!topicIds || !groupIds || (scopeInput.mode === "all" && (topicIds.length || groupIds.length))) return null;
  return {
    permissions: [...new Set(input.permissions as McpPermission[])],
    scope: { mode: scopeInput.mode, topicIds, groupIds },
    includeMemos: input.includeMemos, allowUrl: input.allowUrl,
    ratePerMinute: input.ratePerMinute, expiresAt: input.expiresAt as number | null,
  };
}

async function validateScope(db: D1Database, userId: string, scope: McpTokenScope): Promise<boolean> {
  if (scope.mode === "all") return true;
  const nodes = await listMcpScopeNodes(db, userId);
  const topics = new Set(nodes.filter((node) => node.depth === 0).map((node) => node.id));
  const groups = new Set(nodes.filter((node) => node.depth === 1).map((node) => node.id));
  return scope.topicIds.every((id) => topics.has(id)) && scope.groupIds.every((id) => groups.has(id));
}

export async function listTokens(db: D1Database, userId: string): Promise<McpTokenView[]> {
  return listMcpTokens(db, userId);
}

export async function listScopeOptions(db: D1Database, userId: string) {
  return listMcpScopeNodes(db, userId);
}

export async function createToken(
  db: D1Database, userId: string, pepper: string, rawConfig: unknown, now = Date.now(),
): Promise<{ token: McpTokenView; secret: string } | null> {
  const config = rawConfig === undefined || rawConfig === null ? DEFAULT_CONFIG : normalizeMcpTokenConfig(rawConfig, now);
  if (!config || !(await validateScope(db, userId, config.scope))) return null;
  const secret = generateMcpToken();
  const id = crypto.randomUUID();
  const token: McpToken = {
    id, userId, tokenPrefix: `${secret.slice(0, 11)}…`, tokenHash: await hashMcpToken(secret),
    tokenEnc: { ciphertext: await sealMcpToken(pepper, secret) }, ...config,
    revokedAt: null, createdAt: now, lastUsedAt: null,
  };
  await insertMcpToken(db, userId, {
    ...config, id, tokenPrefix: token.tokenPrefix, tokenHash: token.tokenHash,
    tokenCiphertext: token.tokenEnc.ciphertext, createdAt: now,
  });
  const { tokenHash: _hash, tokenEnc: _enc, ...view } = token;
  return { token: view, secret };
}

export async function updateToken(
  db: D1Database, userId: string, id: string, rawConfig: unknown, now = Date.now(),
): Promise<boolean | null> {
  const config = normalizeMcpTokenConfig(rawConfig, now);
  if (!config) return null;
  if (!(await validateScope(db, userId, config.scope))) return null;
  return updateMcpTokenConfig(db, userId, id, config);
}

export async function revealToken(db: D1Database, userId: string, pepper: string, id: string): Promise<string | null> {
  const token = await getMcpToken(db, userId, id);
  if (!token || token.revokedAt !== null) return null;
  return openMcpToken(pepper, token.tokenEnc.ciphertext);
}

export async function revokeToken(db: D1Database, userId: string, id: string, now = Date.now()): Promise<boolean> {
  return revokeMcpToken(db, userId, id, now);
}

export async function authenticateMcpToken(db: D1Database, secret: string, pepper: string, now = Date.now()): Promise<McpToken | null> {
  if (!pepper.trim() || !secret.startsWith("mn_") || secret.length > 100) return null;
  const token = await findMcpTokenByHash(db, await hashMcpToken(secret));
  if (!token || token.revokedAt !== null || (token.expiresAt !== null && token.expiresAt <= now)) return null;
  if (!(await touchMcpToken(db, token.id, now))) return null;
  return token;
}
