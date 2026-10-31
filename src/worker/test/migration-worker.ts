import { migrations } from "../src/db/migrations";
import { migrateSchema, schemaStatus } from "../src/services/schema";
import { requestSummary, sampleRequest } from "../src/services/monitor";

export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    const route = new URL(request.url).pathname;
    if (route === "/summary" || route === "/summary-month") {
      try { return Response.json(await requestSummary(env.DB, 1_800_000_001_000, route === "/summary-month" ? "utc_month" : "utc_day")); }
      catch { return new Response("unavailable", { status: 503 }); }
    }
    if (route === "/sample") {
      await sampleRequest(env.DB, 1_800_000_001_000, 0);
      return new Response("sampled");
    }
    const registry = route === "/upgrade"
      ? [...migrations, { version: migrations.length + 1, name: "next_test", statements: ["CREATE TABLE test_upgrade (id INTEGER)"] }]
      : route === "/fail"
        ? [...migrations, { version: migrations.length + 1, name: "next_test", statements: ["CREATE TABLE test_upgrade (id INTEGER)", "invalid sql"] }]
        : migrations;
    try {
      const result = route === "/status"
        ? await schemaStatus(env.DB, registry)
        : await migrateSchema(env.DB, registry);
      return new Response(result);
    } catch {
      return new Response("failed", { status: 500 });
    }
  },
};
