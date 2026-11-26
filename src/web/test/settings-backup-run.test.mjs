import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let allowSync = true;
globalThis.menoteSettingsTestSync = async () => allowSync;
const bundle = await build({
  stdin: {
    contents: "export { getBackupRun, runBackups } from './src/services/backupService'; export { appRoutePath, parseAppRoute } from './src/app/appRoutes';",
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  format: "esm",
  write: false,
  plugins: [{ name: "settings-sync-fixture", setup(builder) {
    builder.onResolve({ filter: /\/syncEngine$/ }, () => ({ path: "syncEngine", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: "export const requestSyncNow = () => globalThis.menoteSettingsTestSync();",
    }));
  } }],
});
const { appRoutePath, parseAppRoute, getBackupRun, runBackups } =
  await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));

test("the settings directory, new pages and existing deep links round-trip", () => {
  for (const section of ["overview", "appearance", "editor", "backup", "sync", "mcp", "data", "attachments", "style", "syncLogs", "propertyTemplates"]) {
    const route = { kind: "settings", section };
    assert.deepEqual(parseAppRoute(appRoutePath(route)), route);
  }
  assert.equal(appRoutePath({ kind: "settings", section: "overview" }), "/settings");
});

test("a backup run prevents duplicate requests and reports each completed target", async (t) => {
  const calls = [];
  let finishFirst;
  const firstResponse = new Promise(resolve => { finishFirst = resolve; });
  t.mock.method(globalThis, "fetch", (path) => {
    calls.push(path);
    if (calls.length === 1) return firstResponse;
    return Promise.resolve(Response.json({ ok: true, shards: 2, cleanupError: "remote unavailable" }));
  });
  const targets = [{ id: "first", name: null }, { id: "second", name: "Second" }];
  const running = runBackups("local-account", targets, false);
  await runBackups("local-account", targets, false);
  assert.deepEqual(calls, ["/api/backup/run/first"]);
  assert.equal(getBackupRun("other-account").running, false);
  finishFirst(Response.json({ ok: false, error: "connection failed" }, { status: 502 }));
  await running;
  const result = getBackupRun("local-account");
  assert.equal(result.running, false);
  assert.deepEqual(calls, ["/api/backup/run/first", "/api/backup/run/second"]);
  assert.deepEqual(result.results.map(({ id, ok }) => [id, ok]), [["first", false], ["second", true]]);
  assert.match(result.results[1].detail, /清理失败/);
});

test("manual backup of all targets waits for confirmed sync", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("unexpected request"); });
  allowSync = false;
  try {
    await runBackups("offline-account", [{ id: "first", name: "First" }], true);
    assert.equal(fetch.mock.callCount(), 0);
    assert.match(getBackupRun("offline-account").status, /尚未确认同步/);
  } finally {
    allowSync = true;
  }
});
