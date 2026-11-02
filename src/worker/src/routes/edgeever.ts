import { Hono } from "hono";
import type { AppEnv } from "../middleware/session";
import { requireSession, resolveSession } from "../middleware/session";
import { readEdgeEverRevision } from "../services/edgeeverService";

export const edgeEverRoutes = new Hono<AppEnv>();
edgeEverRoutes.use("/api/edgeever/*", resolveSession);
edgeEverRoutes.get("/api/edgeever/revision", requireSession, async (c) => {
  try {
    const revision = await readEdgeEverRevision();
    if (!revision) return c.json({ error: "edgeever_upstream_unavailable" }, 502);
    return c.json(revision, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch {
    return c.json({ error: "edgeever_upstream_unavailable" }, 502);
  }
});
