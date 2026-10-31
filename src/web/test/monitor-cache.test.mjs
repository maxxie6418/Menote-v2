import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({ entryPoints: [fileURLToPath(new URL("../src/services/monitor.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "browser" });
const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("monitor queries are cached per period for at most one minute", async () => {
  const oldFetch = globalThis.fetch;
  const oldNow = Date.now;
  let now = 100000;
  let calls = 0;
  Date.now = () => now;
  globalThis.fetch = async (url) => {
    calls++;
    const period = new URL(url, "http://localhost").searchParams.get("period");
    return Response.json({ metric: "worker_api_requests", source: "sampled_application_estimate", period,
      estimatedRequests: null, sampleCount: 0, sampledAt: null, sampleRate: 0.01,
      quota: 100000, quotaSource: "cloudflare_free_plan_reference", quotaSharedAcrossAccount: true, points: [] });
  };
  try {
    const signal = new AbortController().signal;
    await service.getMonitorSummary("utc_day", signal);
    await service.getMonitorSummary("utc_day", signal);
    assert.equal(calls, 1);
    await service.getMonitorSummary("utc_month", signal);
    assert.equal(calls, 2);
    now += 60000;
    await service.getMonitorSummary("utc_day", signal);
    assert.equal(calls, 3);
    now += 60000;
    globalThis.fetch = async () => { calls++; return Response.json({ metric: "worker_api_requests", source: "sampled_application_estimate", period: "utc_day" }); };
    assert.equal(await service.getMonitorSummary("utc_day", signal), null);
    assert.equal(await service.getMonitorSummary("utc_day", signal), null);
    assert.equal(calls, 5);
  } finally { globalThis.fetch = oldFetch; Date.now = oldNow; }
});
