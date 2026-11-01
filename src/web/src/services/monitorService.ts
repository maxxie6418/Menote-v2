import type { CloudflareMonitorConnection, CloudflareMonitorMetrics, CloudflareMonitorSetup, MonitorSummary } from "@menote/shared";

// M1 only: the cached value contains installation-level test metrics, never note content.
const CACHE_MS = 60_000;
const cache = new Map<MonitorSummary["period"], { at: number; value: MonitorSummary }>();

export async function getCloudflareConnection(signal: AbortSignal): Promise<CloudflareMonitorConnection> {
  const response = await fetch("/api/monitor/cloudflare/config", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("无法读取 Cloudflare 连接状态");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || typeof (value as CloudflareMonitorConnection).configured !== "boolean") throw new Error("Cloudflare 连接状态格式无效");
  return value as CloudflareMonitorConnection;
}

export async function saveCloudflareConnection(value: CloudflareMonitorSetup): Promise<void> {
  const response = await fetch("/api/monitor/cloudflare/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), cache: "no-store" });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    throw new Error(typeof body === "object" && body !== null && typeof Reflect.get(body, "error") === "string" ? String(Reflect.get(body, "error")) : "Cloudflare 连接验证失败");
  }
}

export async function deleteCloudflareConnection(): Promise<void> {
  const response = await fetch("/api/monitor/cloudflare/config", { method: "DELETE", cache: "no-store" });
  if (!response.ok) throw new Error("无法移除 Cloudflare 连接");
}

export async function getSavedCloudflareToken(signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/monitor/cloudflare/token", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("无法读取已保存的 Token");
  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || typeof Reflect.get(body, "token") !== "string") throw new Error("Cloudflare Token 响应格式无效");
  return Reflect.get(body, "token") as string;
}

export async function getCloudflareMetrics(period: MonitorSummary["period"], signal: AbortSignal): Promise<CloudflareMonitorMetrics | null> {
  const response = await fetch(`/api/monitor/cloudflare/metrics?period=${period}`, { signal, cache: "no-store" });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body === "object" && body !== null && typeof Reflect.get(body, "error") === "string" ? String(Reflect.get(body, "error")) : "Cloudflare Analytics API 暂不可用");
  }
  if (typeof body !== "object" || body === null) throw new Error("Cloudflare 指标响应格式无效");
  const metrics = Reflect.get(body, "metrics");
  return metrics === null ? null : validCloudflareMetrics(metrics) ? metrics : (() => { throw new Error("Cloudflare 指标响应格式无效"); })();
}

function validCloudflareMetrics(value: unknown): value is CloudflareMonitorMetrics {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<CloudflareMonitorMetrics>;
  const nonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  return v.source === "cloudflare_graphql" && Number.isSafeInteger(v.sampledAt) && nonnegative(v.sampledAt) &&
    (v.billing === null || (typeof v.billing === "object" && v.billing !== null && nonnegative(v.billing.amount) && /^[A-Z]{3}$/.test(v.billing.currency) && Array.isArray(v.billing.days) && v.billing.days.every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date) && nonnegative(day.amount)))) &&
    typeof v.worker === "object" && v.worker !== null && nonnegative(v.worker.requests) && nonnegative(v.worker.errors) && Array.isArray(v.worker.points) && v.worker.points.every((point) => Number.isSafeInteger(point.bucketAt) && nonnegative(point.requests)) &&
    (v.worker.cpuTimeP50 === null || nonnegative(v.worker.cpuTimeP50)) && (v.worker.cpuTimeP99 === null || nonnegative(v.worker.cpuTimeP99)) &&
    (v.d1 === null || (typeof v.d1 === "object" && v.d1 !== null && nonnegative(v.d1.rowsRead) && nonnegative(v.d1.rowsWritten) && (v.d1.sizeBytes === null || nonnegative(v.d1.sizeBytes)))) &&
    (v.r2 === null || (typeof v.r2 === "object" && v.r2 !== null && nonnegative(v.r2.objectCount) && nonnegative(v.r2.payloadBytes) && nonnegative(v.r2.metadataBytes) && nonnegative(v.r2.operations) && nonnegative(v.r2.bytesUploaded) && nonnegative(v.r2.bytesDownloaded)));
}

function periodStart(period: MonitorSummary["period"], now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), period === "utc_day" ? date.getUTCDate() : period === "utc_week" ? date.getUTCDate() - 6 : 1);
}

export async function getMonitorSummary(period: MonitorSummary["period"], signal: AbortSignal, force = false): Promise<MonitorSummary | null> {
  const startedAt = Date.now();
  const existing = cache.get(period);
  if (!force && existing && startedAt >= existing.at && startedAt - existing.at < CACHE_MS &&
      periodStart(period, existing.at) === periodStart(period, startedAt)) return existing.value;
  try {
    const response = await fetch(`/api/monitor?period=${period}`, { signal, cache: "no-store" });
    if (!response.ok) return null;
    const result: unknown = await response.json();
    const receivedAt = Date.now();
    if (signal.aborted || !validSummary(result, period) || receivedAt < startedAt ||
        periodStart(period, startedAt) !== periodStart(period, receivedAt)) return null;
    cache.set(period, { at: startedAt, value: result });
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
