import { MOBILE_API, MOBILE_CAPTURE_MAX_CHARS, type MobileApiInfo } from "@menote/shared";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { sameOriginGuard, type AppEnv } from "../middleware/session";
import { AuthError, ensureSchemaReady, pepperKeyMaterial } from "../services/authService";
import { captureMobile, loginMobile, logoutMobile } from "../services/mobileCaptureService";

export const mobileRoutes = new Hono<AppEnv>();

function mobileGuard(handler: (c: Context<AppEnv>) => Promise<Response>) {
  return async (c: Context<AppEnv>): Promise<Response> => {
    c.header("Cache-Control", "no-store");
    try {
      pepperKeyMaterial(c.env);
      if (!(await ensureSchemaReady(c.env.DB))) throw new AuthError(503, "auth_unconfigured");
      return await handler(c);
    } catch (error) {
      if (error instanceof AuthError) return c.json({ error: error.code }, error.status as 400 | 401 | 409 | 429 | 503);
      return c.json({ error: "unavailable" }, 503);
    }
  };
}

mobileRoutes.get(MOBILE_API.info, mobileGuard(async (c) => c.json({ protocol: 1 } satisfies MobileApiInfo)));
mobileRoutes.post(MOBILE_API.login, sameOriginGuard, bodyLimit({ maxSize: 4096 }), mobileGuard(async (c) => {
  return c.json(await loginMobile(c.env, await c.req.json().catch(() => null), Date.now()));
}));
mobileRoutes.post(MOBILE_API.logout, sameOriginGuard, mobileGuard(async (c) => {
  await logoutMobile(c.env.DB, c.req.header("Authorization"));
  return c.body(null, 204);
}));
mobileRoutes.post(MOBILE_API.capture, sameOriginGuard, bodyLimit({ maxSize: MOBILE_CAPTURE_MAX_CHARS * 6 + 1024 }),
  mobileGuard(async (c) => {
    const result = await captureMobile(c.env.DB, c.req.header("Authorization"), await c.req.json().catch(() => null), Date.now());
    return c.json(result, result.result === "applied" ? 201 : 200);
  }),
);
