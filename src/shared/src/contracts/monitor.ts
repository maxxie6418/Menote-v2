export interface MonitorPoint {
  bucketAt: number;
  estimatedRequests: number;
  sampleCount: number;
}

/** Installation-wide, sampled API requests. This is not account billing data. */
export interface MonitorSummary {
  metric: "worker_api_requests";
  source: "sampled_application_estimate";
  period: "utc_day" | "utc_month";
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
}

export const DEFAULT_MONITOR_PREFERENCES: Readonly<MonitorPreferences> = {
  dailyQuota: 100_000, reminder: 70, warning: 85, critical: 95,
};
