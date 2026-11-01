import type { CloudflareMonitorConnection, CloudflareMonitorMetrics, CloudflareMonitorSetup, MonitorSummary } from "@menote/shared";
import { deleteCloudflareCredentials, readCloudflareCredentials, writeCloudflareCredentials, type MonitorCloudflareRow } from "../db/monitor";

type GraphQLPayload = { data?: Record<string, unknown>; errors?: Array<{ message?: string }> };
type MetricGroup = { sum?: Record<string, number | null>; max?: Record<string, number | null>; quantiles?: Record<string, number | null>; dimensions?: Record<string, string> };

const WORKER_QUERY = `query MonitorWorkers($accountTag: string!, $start: Time!, $end: Time!, $scriptName: string!) {
  viewer { accounts(filter: { accountTag: $accountTag }) { workersInvocationsAdaptive(limit: 1000, filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }) { sum { requests errors } quantiles { cpuTimeP50 cpuTimeP99 } dimensions { datetime } } } }
}`;
const D1_QUERY = `query MonitorD1($accountTag: string!, $start: Date!, $end: Date!, $databaseId: string!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }) { sum { rowsRead rowsWritten } }
    d1StorageAdaptiveGroups(limit: 100, filter: { date_geq: $start, date_leq: $end, databaseId: $databaseId }, orderBy: [date_DESC]) { max { databaseSizeBytes } dimensions { date } }
  } }
}`;
const R2_QUERY = `query MonitorR2($accountTag: string!, $start: Time!, $end: Time!, $bucketName: string!) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    r2StorageAdaptiveGroups(limit: 100, filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucketName }, orderBy: [datetime_DESC]) { max { objectCount uploadCount payloadSize metadataSize } dimensions { datetime } }
    r2OperationsAdaptiveGroups(limit: 1000, filter: { datetime_geq: $start, datetime_leq: $end, bucketName: $bucketName }) { sum { requests } }
  } }
}`;
const R2_BANDWIDTH_QUERY = `query MonitorR2Bandwidth($accountTag: string!, $start: Time!, $end: Time!, $bucketName: string!) {
  viewer { accounts(filter: { accountTag: $accountTag }) { r2BandwidthUsageAdaptiveGroups(limit: 1000, filter: { datetime_geq: $start, datetime_lt: $end, bucketName: $bucketName }) { sum { bytesUpload bytesDownload } } } }
}`;

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}
function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function cryptoKey(pepper: string): Promise<CryptoKey> {
  const source = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("menote/cloudflare-monitor-token-v1") }, source, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function sealToken(pepper: string, token: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(pepper), new TextEncoder().encode(token));
  return `${encodeBase64(iv)}.${encodeBase64(new Uint8Array(cipher))}`;
}
async function readToken(pepper: string, value: string): Promise<string> {
  const [iv, ciphertext] = value.split(".");
  if (!iv || !ciphertext) throw new Error("Cloudflare Token 密文无效");
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(iv) }, await cryptoKey(pepper), decodeBase64(ciphertext));
  return new TextDecoder().decode(plain);
}

function validateSetup(setup: CloudflareMonitorSetup): void {
  if (!/^[0-9a-f]{32}$/i.test(setup.accountId)) throw new Error("Account ID 需为 32 位十六进制字符");
  if (!setup.apiToken.trim() || setup.apiToken.length > 512) throw new Error("请填写有效的只读 API Token");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(setup.scriptName)) throw new Error("Worker 名称格式无效");
  if (setup.d1DatabaseId && !/^[0-9a-f-]{36}$/i.test(setup.d1DatabaseId)) throw new Error("D1 数据库 ID 格式无效");
  if (setup.r2BucketName && !/^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/i.test(setup.r2BucketName)) throw new Error("R2 桶名格式无效");
}

async function query<T>(token: string, q: string, variables: Record<string, string>): Promise<T> {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, variables }),
  });
  let payload: GraphQLPayload;
  try { payload = await response.json() as GraphQLPayload; }
  catch { throw new Error("Cloudflare Analytics API 返回了无法识别的响应"); }
  if (!response.ok || payload.errors?.length) throw new Error("Cloudflare Analytics API 查询失败：请检查 Token 权限、资源标识与时间范围");
  return payload.data as T;
}

function groups(data: Record<string, unknown>, name: string): MetricGroup[] {
  const viewer = data.viewer as { accounts?: Array<Record<string, unknown>> } | undefined;
  const values = viewer?.accounts?.[0]?.[name];
  if (!Array.isArray(values)) throw new Error("Cloudflare Analytics API 缺少预期数据");
  return values as MetricGroup[];
}
function sumField(rows: MetricGroup[], field: string): number {
  return rows.reduce((total, row) => total + (typeof row.sum?.[field] === "number" ? row.sum[field]! : 0), 0);
}
function maxField(rows: MetricGroup[], field: string): number | null {
  const values = rows.map((row) => row.max?.[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}
function latestField(rows: MetricGroup[], field: string, dimension: string): number | null {
  const ordered = [...rows].sort((a, b) => (b.dimensions?.[dimension] ?? "").localeCompare(a.dimensions?.[dimension] ?? ""));
  const value = ordered[0]?.max?.[field];
  return typeof value === "number" && Number.isFinite(value) ? value : maxField(rows, field);
}
function quantileField(rows: MetricGroup[], field: string): number | null {
  const values = rows.map((row) => row.quantiles?.[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : null;
}

function dates(period: MonitorSummary["period"], now: number) {
  const date = new Date(now);
  const start = period === "utc_day"
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    : period === "utc_week" ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 6))
      : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return { start: start.toISOString(), end: date.toISOString(), dateStart: start.toISOString().slice(0, 10), dateEnd: date.toISOString().slice(0, 10) };
}

async function loadMetrics(token: string, row: MonitorCloudflareRow, period: MonitorSummary["period"], now: number): Promise<CloudflareMonitorMetrics> {
  const range = dates(period, now);
  const workerData = await query<Record<string, unknown>>(token, WORKER_QUERY, { accountTag: row.accountId, start: range.start, end: range.end, scriptName: row.scriptName });
  const workerRows = groups(workerData, "workersInvocationsAdaptive");
  const worker = {
    requests: sumField(workerRows, "requests"), errors: sumField(workerRows, "errors"),
    cpuTimeP50: quantileField(workerRows, "cpuTimeP50"), cpuTimeP99: quantileField(workerRows, "cpuTimeP99"),
    points: workerRows.flatMap((entry) => {
      const bucketAt = Date.parse(entry.dimensions?.datetime ?? "");
      const requests = entry.sum?.requests;
      return Number.isFinite(bucketAt) && typeof requests === "number" ? [{ bucketAt, requests }] : [];
    }),
  };
  let d1: CloudflareMonitorMetrics["d1"] = null;
  if (row.d1DatabaseId) {
    const result = await query<Record<string, unknown>>(token, D1_QUERY, { accountTag: row.accountId, start: range.dateStart, end: range.dateEnd, databaseId: row.d1DatabaseId });
    const usage = groups(result, "d1AnalyticsAdaptiveGroups");
    const storage = groups(result, "d1StorageAdaptiveGroups");
    d1 = { rowsRead: sumField(usage, "rowsRead"), rowsWritten: sumField(usage, "rowsWritten"), sizeBytes: latestField(storage, "databaseSizeBytes", "date") };
  }
  let r2: CloudflareMonitorMetrics["r2"] = null;
  if (row.r2BucketName) {
    const result = await query<Record<string, unknown>>(token, R2_QUERY, { accountTag: row.accountId, start: range.start, end: range.end, bucketName: row.r2BucketName });
    const storage = groups(result, "r2StorageAdaptiveGroups");
    const operations = groups(result, "r2OperationsAdaptiveGroups");
    const bandwidthResult = await query<Record<string, unknown>>(token, R2_BANDWIDTH_QUERY, { accountTag: row.accountId, start: range.start, end: range.end, bucketName: row.r2BucketName });
    const bandwidth = groups(bandwidthResult, "r2BandwidthUsageAdaptiveGroups");
    r2 = { objectCount: latestField(storage, "objectCount", "datetime") ?? 0, payloadBytes: latestField(storage, "payloadSize", "datetime") ?? 0, metadataBytes: latestField(storage, "metadataSize", "datetime") ?? 0, operations: sumField(operations, "requests"), bytesUploaded: sumField(bandwidth, "bytesUpload"), bytesDownloaded: sumField(bandwidth, "bytesDownload") };
  }
  const billing = await readBillableUsage(token, row.accountId, range.dateStart, range.dateEnd).catch(() => null);
  return { source: "cloudflare_graphql", sampledAt: now, worker, d1, r2, billing };
}

interface BillableUsageRow { BilledCost?: unknown; BillingCurrency?: unknown; ChargePeriodStart?: unknown }
async function readBillableUsage(token: string, accountId: string, from: string, to: string) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/billable-usage`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!response.ok) return null;
  const payload = await response.json() as { result?: BillableUsageRow[] };
  if (!Array.isArray(payload.result)) return null;
  const days = new Map<string, number>();
  let currency: string | null = null;
  for (const row of payload.result) {
    const amount = typeof row.BilledCost === "number" && Number.isFinite(row.BilledCost) ? row.BilledCost : null;
    const date = typeof row.ChargePeriodStart === "string" ? row.ChargePeriodStart.slice(0, 10) : null;
    if (amount === null || !date) continue;
    if (typeof row.BillingCurrency === "string") currency = row.BillingCurrency;
    days.set(date, (days.get(date) ?? 0) + amount);
  }
  if (currency === null) return null;
  return { amount: [...days.values()].reduce((sum, value) => sum + value, 0), currency, days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount })) };
}

export async function readCloudflareConnection(db: D1Database, userId: string): Promise<CloudflareMonitorConnection> {
  const row = await readCloudflareCredentials(db, userId);
  return row ? { configured: true, accountId: row.accountId, scriptName: row.scriptName, d1DatabaseId: row.d1DatabaseId, r2BucketName: row.r2BucketName }
    : { configured: false, accountId: null, scriptName: null, d1DatabaseId: null, r2BucketName: null };
}

export async function saveCloudflareConnection(db: D1Database, userId: string, pepper: string, setup: CloudflareMonitorSetup, now: number): Promise<void> {
  validateSetup(setup);
  const row = { accountId: setup.accountId.toLowerCase(), tokenCiphertext: await sealToken(pepper, setup.apiToken.trim()), scriptName: setup.scriptName, d1DatabaseId: setup.d1DatabaseId || null, r2BucketName: setup.r2BucketName || null };
  const token = setup.apiToken.trim();
  await loadMetrics(token, row, "utc_day", now);
  await writeCloudflareCredentials(db, userId, row, now);
}

export async function clearCloudflareConnection(db: D1Database, userId: string): Promise<void> { await deleteCloudflareCredentials(db, userId); }

export async function revealCloudflareToken(db: D1Database, userId: string, pepper: string): Promise<string | null> {
  const row = await readCloudflareCredentials(db, userId);
  return row ? readToken(pepper, row.tokenCiphertext) : null;
}

export async function readCloudflareMetrics(db: D1Database, userId: string, pepper: string, period: MonitorSummary["period"], now: number): Promise<CloudflareMonitorMetrics | null> {
  const row = await readCloudflareCredentials(db, userId);
  if (!row) return null;
  return loadMetrics(await readToken(pepper, row.tokenCiphertext), row, period, now);
}
