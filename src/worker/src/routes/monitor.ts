import { requestSummary } from "../services/monitorService";

export async function monitorRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const pepper: unknown = Reflect.get(env, "AUTH_PEPPER");
  if (typeof pepper !== "string" || !pepper.trim() || !env.DB) return new Response(null, { status: 503 });
  const period = new URL(request.url).searchParams.get("period") ?? "utc_day";
  if (period !== "utc_day" && period !== "utc_month") return new Response(null, { status: 400 });
  try {
    return Response.json(await requestSummary(env.DB, Date.now(), period), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
