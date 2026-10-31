import type { HealthResponse } from "@menote/shared";

export async function getReadiness(signal: AbortSignal): Promise<HealthResponse> {
  try {
    const response = await fetch("/api/health/ready", { signal, cache: "no-store" });
    const body: unknown = await response.json();
    if (response.ok && typeof body === "object" && body !== null &&
        "status" in body && body.status === "ready") return { status: "ready" };
  } catch (error) {
    if (signal.aborted) throw error;
  }
  return { status: "unavailable" };
}
