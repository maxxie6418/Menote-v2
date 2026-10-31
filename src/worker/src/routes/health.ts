import type { HealthResponse } from "@menote/shared";
import { readiness } from "../services/healthService";

export async function healthRoute(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  if (path === "/api/health/live") return Response.json({ status: "alive" } satisfies HealthResponse);
  if (path === "/api/health/ready") {
    const result = await readiness(env);
    return Response.json(result, { status: result.status === "ready" ? 200 : 503,
      headers: { "Cache-Control": "no-store" } });
  }
  return new Response(null, { status: 404 });
}
