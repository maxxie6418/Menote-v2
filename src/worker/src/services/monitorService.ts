import { DEFAULT_MONITOR_PREFERENCES, type MonitorSummary } from "@menote/shared";
import { insertRequestSample, readRequestSamples } from "../db/monitor";
import { ledgerReady } from "./schemaService";

// A 1% sample bounds writes to approximately one per 100 API invocations.
export const REQUEST_SAMPLE_RATE = 0.01;
export const FREE_DAILY_REQUESTS = DEFAULT_MONITOR_PREFERENCES.dailyQuota;

export async function sampleRequest(
  db: D1Database, now = Date.now(), draw = Math.random(), userId?: string,
): Promise<void> {
  if (draw < REQUEST_SAMPLE_RATE) await insertRequestSample(db, 1 / REQUEST_SAMPLE_RATE, now, userId);
}

export async function requestSummary(db: D1Database, now = Date.now(), period: MonitorSummary["period"] = "utc_day"): Promise<MonitorSummary> {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = period === "utc_day" ? Date.UTC(year, month, date.getUTCDate()) : Date.UTC(year, month, 1);
  const end = period === "utc_day" ? start + 86_400_000 : Date.UTC(year, month + 1, 1);
  const bucketSize = period === "utc_day" ? 3_600_000 : 86_400_000;
  const { ledger, row, points } = await readRequestSamples(db, start, end, bucketSize);
  if (!ledgerReady(ledger)) throw new Error("Schema is incompatible");
  return {
    metric: "worker_api_requests", source: "sampled_application_estimate", period,
    estimatedRequests: row?.estimate ?? null, sampleCount: row?.samples ?? 0,
    sampledAt: row.lastSample, sampleRate: REQUEST_SAMPLE_RATE,
    quota: FREE_DAILY_REQUESTS, quotaSource: "cloudflare_free_plan_reference", quotaSharedAcrossAccount: true, points,
  };
}
