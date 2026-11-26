import { Hono, type Context } from "hono";
import * as z from "zod/v4";
import { resolveItemId } from "@menote/shared";
import { type AppEnv, requireSession, resolveSession, sameOriginGuard } from "../middleware/session";
import { ensureSchemaReady } from "../services/authService";
import { MemoryError, connectMemoryTable, createAndConnectMemoryTable, disconnectMemoryTable, enableMemoryPlugin, memoryPluginStatus, previewMemoryBinding } from "../services/memoryService";
import { MemoryTableError } from "../services/memoryTable";

export const memoryRoutes = new Hono<AppEnv>();
const tableInput = z.string().trim().min(1).max(2048).transform(resolveItemId).pipe(z.string().min(1).max(128));
memoryRoutes.use("/api/memory/*", resolveSession, requireSession, async (c, next) => {
  if (!await ensureSchemaReady(c.env.DB)) return c.json({ error: "unavailable" }, 503);
  c.header("Cache-Control", "no-store");
  await next();
});

function failed(c: Context<AppEnv>, error: unknown) {
  if (error instanceof MemoryError || error instanceof MemoryTableError) return c.json({ error: error.code }, 409);
  throw error;
}

memoryRoutes.get("/api/memory/status", async (c) => c.json(await memoryPluginStatus(c.env.DB, c.get("authUser")!.id)));

memoryRoutes.put("/api/memory/enabled", sameOriginGuard, async (c) => {
  const input = z.object({ enabled: z.boolean() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_input" }, 400);
  return c.json(await enableMemoryPlugin(c.env.DB, c.get("authUser")!.id, input.data.enabled));
});

memoryRoutes.post("/api/memory/binding/preview", sameOriginGuard, async (c) => {
  const input = z.object({ tableId: tableInput }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_input" }, 400);
  try { return c.json(await previewMemoryBinding(c.env.DB, c.get("authUser")!.id, input.data.tableId, Date.now())); }
  catch (error) { return failed(c, error); }
});

memoryRoutes.put("/api/memory/binding", sameOriginGuard, async (c) => {
  const input = z.object({ tableId: tableInput, rev: z.number().int().positive() }).strict().safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: "invalid_input" }, 400);
  try { return c.json(await connectMemoryTable(c.env.DB, c.get("authUser")!.id, input.data.tableId, input.data.rev, Date.now())); }
  catch (error) { return failed(c, error); }
});

memoryRoutes.post("/api/memory/binding/new", sameOriginGuard, async (c) => {
  try { return c.json(await createAndConnectMemoryTable(c.env.DB, c.get("authUser")!.id, Date.now()), 201); }
  catch (error) { return failed(c, error); }
});

memoryRoutes.delete("/api/memory/binding/:id", sameOriginGuard, async (c) => {
  const input = z.uuid().safeParse(c.req.param("id"));
  if (!input.success) return c.json({ error: "invalid_input" }, 400);
  try { return c.json(await disconnectMemoryTable(c.env.DB, c.get("authUser")!.id, input.data)); }
  catch (error) { return failed(c, error); }
});
