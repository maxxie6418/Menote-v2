import { Hono } from "hono";
import { dispatchScheduled } from "./jobs/scheduled";
import { observeRequest } from "./middleware/monitor";
import type { AppEnv } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { monitorRoutes } from "./routes/monitor";

/* 仅装配：路由注册与请求观察（FR-DEP-4/工程设计 §4，入口 ≤200 行）。 */
const app = new Hono<AppEnv>()
  .route("/", healthRoutes)
  .route("/", authRoutes)
  .route("/", monitorRoutes);

export default {
  scheduled: dispatchScheduled,
  fetch(request, env, ctx) {
    observeRequest(env, ctx, request);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
