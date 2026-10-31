import { migrations } from "./migrations";

const INSTALLATION_SCOPE = "__m1_installation_test__";
const METRIC = "api_requests";
const HOUR_MS = 3_600_000;

/** The ledger check and sampled write run in one SQLite statement.
 *  G1 起：样本按会话归属写入 user_id，公开流量保留安装级范围；汇总统计仍为应用级（不区分 user_id）。 */
export async function insertRequestSample(
  db: D1Database, weight: number, sampledAt: number, userId: string = INSTALLATION_SCOPE,
): Promise<void> {
  const bucket = Math.floor(sampledAt / HOUR_MS) * HOUR_MS;
  const identity = JSON.stringify(migrations.map(({ version, name }) => [version, name]));
  await db.prepare(`INSERT INTO monitor_hourly (user_id, service, metric, bucket_at, estimate, sample_count, last_sample)
    SELECT ?, 'workers', ?, ?, ?, 1, ? WHERE
      (SELECT json_group_array(json_array(version, name)) FROM
        (SELECT version, name FROM schema_migrations ORDER BY version)) = ?
    ON CONFLICT (user_id, service, metric, bucket_at) DO UPDATE SET
      estimate = estimate + excluded.estimate,
      sample_count = sample_count + 1,
      last_sample = MAX(last_sample, excluded.last_sample)`)
    .bind(userId, METRIC, bucket, weight, sampledAt, identity).run();
}

/** Ledger and samples are read in one D1 transaction, preventing mixed-version results. */
export async function readRequestSamples(db: D1Database, since: number, until: number, bucketSize: number) {
  const results = await db.batch<Record<string, unknown>>([
    db.prepare("SELECT version, name FROM schema_migrations ORDER BY version"),
    db.prepare(`SELECT SUM(estimate) AS estimate, COALESCE(SUM(samples), 0) AS samples,
      MAX(last_sample) AS last_sample FROM (
      SELECT SUM(value) AS estimate, COUNT(*) AS samples, MAX(sampled_at) AS last_sample
      FROM monitor_samples WHERE service = 'workers' AND metric = ?
        AND sampled_at >= ? AND sampled_at < ?
      UNION ALL
      SELECT SUM(estimate), COALESCE(SUM(sample_count), 0), MAX(last_sample)
      FROM monitor_hourly WHERE service = 'workers' AND metric = ?
        AND bucket_at >= ? AND bucket_at < ?
    )`).bind(METRIC, since, until, METRIC, since, until),
    db.prepare(`SELECT bucket, SUM(estimate) AS estimate, SUM(samples) AS samples FROM (
      SELECT CAST(sampled_at / ? AS INTEGER) * ? AS bucket, value AS estimate, 1 AS samples
      FROM monitor_samples WHERE service = 'workers' AND metric = ?
        AND sampled_at >= ? AND sampled_at < ?
      UNION ALL
      SELECT CAST(bucket_at / ? AS INTEGER) * ? AS bucket, estimate, sample_count AS samples
      FROM monitor_hourly WHERE service = 'workers' AND metric = ?
        AND bucket_at >= ? AND bucket_at < ?
    ) GROUP BY bucket ORDER BY bucket`)
      .bind(bucketSize, bucketSize, METRIC, since, until,
        bucketSize, bucketSize, METRIC, since, until),
  ]);
  const ledger = results[0].results.map((row) => ({ version: Number(row.version), name: String(row.name) }));
  const aggregate = results[1].results[0];
  return { ledger, row: {
    estimate: typeof aggregate?.estimate === "number" ? aggregate.estimate : null,
    samples: typeof aggregate?.samples === "number" ? aggregate.samples : 0,
    lastSample: typeof aggregate?.last_sample === "number" ? aggregate.last_sample : null,
  }, points: results[2].results.map((point) => ({
    bucketAt: Number(point.bucket), estimatedRequests: Number(point.estimate), sampleCount: Number(point.samples),
  })) };
}
