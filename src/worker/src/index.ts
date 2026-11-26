import { Hono } from "hono";
import { dispatchScheduled } from "./jobs/scheduled";
import { observeRequest } from "./middleware/monitor";
import type { AppEnv } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { attachmentRoutes } from "./routes/attachments";
import { healthRoutes } from "./routes/health";
import { mobileRoutes } from "./routes/mobile";
import { monitorRoutes } from "./routes/monitor";
import { syncRoutes } from "./routes/sync";
import { trashRoutes } from "./routes/trash";
import { backupRoutes } from "./routes/backup";
import { restoreRoutes } from "./routes/restore";
import { recoveryCodeRoutes } from "./routes/recoveryCode";
import { mcpTokenRoutes } from "./routes/mcpTokens";
import { mcpRoutes } from "./routes/mcp";
import { clipTemplateRoutes } from "./routes/clipTemplates";
import { aiRoutes } from "./routes/ai";
import { raindropRoutes } from "./routes/raindrop";
import { memoryRoutes } from "./routes/memory";
import { dispatchAiQueue } from "./services/aiService";
import { pepperKeyMaterial } from "./services/authService";
import { schemaIsCurrent } from "./services/schemaService";

/* 仅装配：路由注册与请求观察（FR-DEP-4/工程设计 §4，入口 ≤200 行）。 */
const app = new Hono<AppEnv>()
  .route("/", healthRoutes)
  .route("/", authRoutes)
  .route("/", mobileRoutes)
  .route("/", attachmentRoutes)
  .route("/", syncRoutes)
  .route("/", trashRoutes)
  .route("/", backupRoutes)
  .route("/", restoreRoutes)
  .route("/", recoveryCodeRoutes)
  .route("/", monitorRoutes)
  .route("/", mcpTokenRoutes)
  .route("/", mcpRoutes)
  .route("/", clipTemplateRoutes)
  .route("/", aiRoutes)
  .route("/", raindropRoutes)
  .route("/", memoryRoutes);

export default {
  async scheduled(_controller: unknown, env: Env, ctx: TaskContext) {
    try { pepperKeyMaterial(env); } catch { return; }
    if (env.DB && env.BUCKET && await schemaIsCurrent(env.DB)) await dispatchScheduled(env, ctx);
  },
  queue(batch: AiMessageBatch, env: Env) {
    return dispatchAiQueue(env, batch);
  },
  fetch(request: Request, env: Env, ctx: TaskContext) {
    observeRequest(env, ctx, request);
    return app.fetch(request, env, ctx);
  },
};
