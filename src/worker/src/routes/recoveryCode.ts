import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { claimRecoveryCode, getRecoveryCodeState } from "../services/recoveryCodeService";

export const recoveryCodeRoutes = new Hono<AppEnv>();
const headers = { "Cache-Control": "no-store" };

recoveryCodeRoutes.get("/api/recovery-code", resolveSession, requireSession, async (c) => {
  if (!await ensureSchemaReady(c.env.DB)) return c.json({ error: "unavailable" }, 503, headers);
  const userId = c.get("authUser")!.id;
  if (c.req.query("account") !== userId) return c.json({ error: "account_changed" }, 409, headers);
  return c.json(await getRecoveryCodeState(c.env.DB, userId), 200, headers);
});

recoveryCodeRoutes.post("/api/recovery-code", resolveSession, sameOriginGuard, requireSession, async (c) => {
  if (!await ensureSchemaReady(c.env.DB)) return c.json({ error: "unavailable" }, 503, headers);
  const userId = c.get("authUser")!.id;
  if (c.req.query("account") !== userId) return c.json({ error: "account_changed" }, 409, headers);
  const result = await claimRecoveryCode(c.env.DB, userId, await c.req.json().catch(() => null));
  if (!result) return c.json({ error: "invalid_recovery_binding" }, 400, headers);
  return c.json(result, result.binding ? 200 : 409, headers);
});
