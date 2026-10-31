import type { MonitorSummary } from "@menote/shared";

// M1 only: the cached value contains installation-level test metrics, never note content.
const CACHE_MS = 60_000;
const cache = new Map<MonitorSummary["period"], { at: number; value: MonitorSummary }>();

export async function getMonitorSummary(period: MonitorSummary["period"], signal: AbortSignal): Promise<MonitorSummary | null> {
  const existing = cache.get(period);
  if (existing && Date.now() - existing.at < CACHE_MS) return existing.value;
  try {
    const response = await fetch(`/api/monitor?period=${period}`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    const result: unknown = await response.json();
    if (!validSummary(result, period)) return null;
    cache.set(period, { at: Date.now(), value: result });
    return result;
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

function validSummary(value: unknown, period: MonitorSummary["period"]): value is MonitorSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<MonitorSummary>;
  const nonnegative = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number >= 0;
  const timestamp = (number: unknown) => Number.isSafeInteger(number) && nonnegative(number) && (number as number) <= 8_640_000_000_000_000;
  return v.metric === "worker_api_requests" && v.source === "sampled_application_estimate" && v.period === period &&
    (v.estimatedRequests === null || nonnegative(v.estimatedRequests)) && Number.isSafeInteger(v.sampleCount) && v.sampleCount! >= 0 &&
    (v.sampledAt === null || timestamp(v.sampledAt)) && nonnegative(v.sampleRate) && v.sampleRate! > 0 && v.sampleRate! <= 1 &&
    nonnegative(v.quota) && v.quota! > 0 && v.quotaSource === "cloudflare_free_plan_reference" && v.quotaSharedAcrossAccount === true &&
    Array.isArray(v.points) && v.points.length <= (period === "utc_day" ? 24 : 31) && v.points.every((point) =>
      typeof point === "object" && point !== null && timestamp(point.bucketAt) && nonnegative(point.estimatedRequests) &&
      Number.isSafeInteger(point.sampleCount) && point.sampleCount > 0);
}
