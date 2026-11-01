export interface MonitorPoint {
  bucketAt: number;
  estimatedRequests: number;
  sampleCount: number;
}

/** Installation-wide, sampled API requests. This is not account billing data. */
export interface MonitorSummary {
  metric: "worker_api_requests";
  source: "sampled_application_estimate";
  period: "utc_day" | "utc_week" | "utc_month";
  estimatedRequests: number | null;
  sampleCount: number;
  sampledAt: number | null;
  sampleRate: number;
  quota: number;
  quotaSource: "cloudflare_free_plan_reference";
  quotaSharedAcrossAccount: true;
  points: MonitorPoint[];
}

/** Device-local M1 preferences; user-scoped settings require authentication in M2. */
export interface MonitorPreferences {
  dailyQuota: number;
  reminder: number;
  warning: number;
  critical: number;
  refreshIntervalMinutes: number;
}

export interface CloudflareMonitorSetup {
  accountId: string;
  apiToken: string;
  scriptName: string;
  d1DatabaseId: string;
  r2BucketName: string;
}

export interface CloudflareMonitorConnection {
  configured: boolean;
  accountId: string | null;
  scriptName: string | null;
  d1DatabaseId: string | null;
  r2BucketName: string | null;
}

export interface CloudflareMonitorMetrics {
  source: "cloudflare_graphql";
  sampledAt: number;
  billing: { amount: number; currency: string; days: Array<{ date: string; amount: number }> } | null;
  worker: { requests: number; errors: number; cpuTimeP50: number | null; cpuTimeP99: number | null; points: Array<{ bucketAt: number; requests: number }> };
  d1: { rowsRead: number; rowsWritten: number; sizeBytes: number | null } | null;
  r2: { objectCount: number; payloadBytes: number; metadataBytes: number; operations: number; bytesUploaded: number; bytesDownloaded: number } | null;
}

export const DEFAULT_MONITOR_PREFERENCES: Readonly<MonitorPreferences> = {
  dailyQuota: 100_000, reminder: 70, warning: 85, critical: 95, refreshIntervalMinutes: 15,
};
