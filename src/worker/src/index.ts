import { observeRequest } from "./middleware/monitor";
import { healthRoute } from "./routes/health";
import { monitorRoute } from "./routes/monitor";

export default {
  fetch(request, env, ctx) {
    observeRequest(env, ctx);
    return new URL(request.url).pathname === "/api/monitor" ? monitorRoute(request, env) : healthRoute(request, env);
  },
} satisfies ExportedHandler<Env>;
