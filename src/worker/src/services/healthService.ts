import type { HealthResponse } from "@menote/shared";
import { migrateSchema } from "./schemaService";

/** Checks and initializes only when all mandatory configuration is present. */
export async function readiness(env: Env): Promise<HealthResponse> {
  const pepper: unknown = Reflect.get(env, "AUTH_PEPPER");
  if (typeof pepper !== "string" || pepper.trim().length === 0 || !env.DB || !env.BUCKET) {
    return { status: "unavailable" };
  }
  try {
    // A read-only R2 operation verifies access without creating test data.
    await env.BUCKET.head("__menote_health_probe__");
    return { status: await migrateSchema(env.DB) === "ready" ? "ready" : "unavailable" };
  } catch {
    // No binding identifiers, secret values, SQL, or internal exception details escape.
    return { status: "unavailable" };
  }
}
