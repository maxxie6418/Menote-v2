import { Hono } from "hono";
import { isClipTemplateV1 } from "@menote/shared";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { deleteClipTemplate, listClipTemplates, persistClipTemplate } from "../services/clipTemplateService";

export const clipTemplateRoutes = new Hono<AppEnv>();
clipTemplateRoutes.use("/api/clip-templates/*", resolveSession);
clipTemplateRoutes.use("/api/clip-templates", resolveSession);
clipTemplateRoutes.get("/api/clip-templates", requireSession, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  return c.json({ templates: await listClipTemplates(c.env.DB, c.get("authUser")!.id) }, { headers: { "Cache-Control": "no-store" } });
});
clipTemplateRoutes.put("/api/clip-templates/:id", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || !("template" in body) || !isClipTemplateV1(body.template) || body.template.id !== c.req.param("id")) return c.json({ error: "invalid_template" }, 400);
  const expectedVersion = "expectedVersion" in body ? body.expectedVersion : undefined;
  if (expectedVersion !== undefined && expectedVersion !== null && (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1)) return c.json({ error: "invalid_version" }, 400);
  const template = await persistClipTemplate(c.env.DB, c.get("authUser")!.id, body.template, Date.now(), expectedVersion as number | null | undefined);
  if (template === "version_conflict") return c.json({ error: "version_conflict" }, 409);
  return template ? c.json({ template }) : c.json({ error: "invalid_template" }, 400);
});
clipTemplateRoutes.delete("/api/clip-templates/:id", requireSession, sameOriginGuard, async (c) => {
  if (!(await ensureSchemaReady(c.env.DB))) return c.json({ error: "unavailable" }, 503);
  const removed = await deleteClipTemplate(c.env.DB, c.get("authUser")!.id, c.req.param("id"));
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
