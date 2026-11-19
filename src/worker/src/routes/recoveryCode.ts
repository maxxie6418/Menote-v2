import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady, pepperKeyMaterial } from "../services/authService";
import { claimRecoveryCode, commitRecoveryCodeRotation, getRecoveryCodeRotation, getRecoveryCodeState } from "../services/recoveryCodeService";

export const recoveryCodeRoutes = new Hono<AppEnv>();
const headers = { "Cache-Control": "no-store" };

const requireRecoveryAccount: MiddlewareHandler<AppEnv> = async (c, next) => {
  try { pepperKeyMaterial(c.env); }
  catch { return c.json({ error: "unavailable" }, 503, headers); }
  if (!await ensureSchemaReady(c.env.DB)) return c.json({ error: "unavailable" }, 503, headers);
  if (c.req.query("account") !== c.get("authUser")!.id) return c.json({ error: "account_changed" }, 409, headers);
  await next();
};

recoveryCodeRoutes.get("/api/recovery-code", resolveSession, requireSession, requireRecoveryAccount, async (c) => {
  return c.json(await getRecoveryCodeState(c.env.DB, c.get("authUser")!.id), 200, headers);
});

recoveryCodeRoutes.post("/api/recovery-code", resolveSession, sameOriginGuard, requireSession, requireRecoveryAccount, async (c) => {
  const result = await claimRecoveryCode(c.env.DB, c.get("authUser")!.id, await c.req.json().catch(() => null));
  if (!result) return c.json({ error: "invalid_recovery_binding" }, 400, headers);
  return c.json(result, result.binding ? 200 : 409, headers);
});

recoveryCodeRoutes.get("/api/recovery-code/rotation", resolveSession, requireSession, requireRecoveryAccount, async (c) => {
  const result = await getRecoveryCodeRotation(c.env.DB, c.get("authUser")!.id);
  return result ? c.json(result, 200, headers) : c.json({ error: "recovery_code_wrap_missing" }, 409, headers);
});

recoveryCodeRoutes.post("/api/recovery-code/rotation", resolveSession, sameOriginGuard, requireSession, requireRecoveryAccount, async (c) => {
  const result = await commitRecoveryCodeRotation(c.env.DB, c.get("authUser")!.id, await c.req.json().catch(() => null), Date.now());
  if (result.error) return c.json({ error: result.error }, result.error === "invalid_recovery_rotation" ? 400 : 409, headers);
  return c.json({ binding: result.binding }, 200, headers);
});
