import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile(new URL("../../../wrangler.jsonc", import.meta.url), "utf8"));

test("version URLs remain disabled until isolation is verified", () => {
  assert.equal(config.preview_urls, false);
  assert.notEqual(config.workers_dev, false, "workers.dev remains available for first-time setup");
  assert.equal(config.env?.preview, undefined, "no shared preview environment is configured");
});

test("deployment declares required resources without public secrets or remote local bindings", () => {
  assert.equal(config.assets?.binding, "ASSETS");
  assert.ok(config.assets?.run_worker_first?.includes("/api/*"));
  assert.equal(config.d1_databases?.some((binding) => binding.binding === "DB"), true);
  assert.equal(config.r2_buckets?.some((binding) => binding.binding === "BUCKET"), true);
  for (const binding of [...config.d1_databases, ...config.r2_buckets]) assert.notEqual(binding.remote, true);
  assert.equal(Object.hasOwn(config.vars ?? {}, "AUTH_PEPPER"), false);
});
