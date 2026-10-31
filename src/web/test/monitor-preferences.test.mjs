import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/monitorPreferencesService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const service = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

test("defaults, valid settings, and persistence", async () => {
  assert.deepEqual(await service.loadMonitorPreferences(), { dailyQuota: 100000, reminder: 70, warning: 85, critical: 95 });
  const updated = { dailyQuota: 50000, reminder: 60, warning: 80, critical: 99 };
  await service.saveMonitorPreferences(updated);
  assert.deepEqual(await service.loadMonitorPreferences(), updated);
});

test("invalid quota or thresholds are rejected without replacing saved settings", async () => {
  const before = await service.loadMonitorPreferences();
  for (const invalid of [
    { ...before, dailyQuota: 0 }, { ...before, dailyQuota: 1.5 },
    { ...before, warning: before.reminder }, { ...before, critical: 101 },
  ]) {
    assert.equal(service.validPreferences(invalid), false);
    await assert.rejects(service.saveMonitorPreferences(invalid));
  }
  assert.deepEqual(await service.loadMonitorPreferences(), before);
});


test("storage failures are reported rather than claiming a successful save", async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open() { throw new Error("storage unavailable"); } };
  try { await assert.rejects(service.saveMonitorPreferences({ dailyQuota: 100, reminder: 70, warning: 85, critical: 95 })); }
  finally { globalThis.indexedDB = previous; }
});
