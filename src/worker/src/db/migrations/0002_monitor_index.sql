CREATE INDEX monitor_samples_lookup
ON monitor_samples (user_id, service, metric, sampled_at)
