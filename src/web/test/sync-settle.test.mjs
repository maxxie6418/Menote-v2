import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

/** 同一打包实例导出 localDb 与 outboxRepo，避免跨 Dexie 实例事务互锁。 */
const bundle = await build({
  stdin: {
    contents: `export { localDb } from "./src/db/localDb"; export * from "./src/db/outboxRepo";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { localDb, toOutboxRow, enqueueOutbox, settleSettingResult } = mod;

const USER = "user-a";
const KEY = "ai";

async function reset() {
  await Promise.all(localDb.tables.map((table) => table.clear()));
}

async function seedSetting(rev) {
  await localDb.settings.put({ userId: USER, key: KEY, sensitivity: "ordinary", value: { enabled: true }, rev, updatedAt: 1 });
}

async function seedOutbox(retries = 0) {
  const row = toOutboxRow({
    operationId: crypto.randomUUID(), userId: USER, entityId: KEY, entity: "setting", action: "upsert",
    baseRev: 0, baseMetaRev: 0, payload: { setting: { userId: USER, key: KEY, sensitivity: "ordinary", value: { enabled: true }, rev: 1, updatedAt: 1 } },
  }, Date.now());
  row.retries = retries;
  await enqueueOutbox([row]);
  return (await localDb.outbox.toArray())[0];
}

test("settleSettingResult aligns drifted local rev and requeues with server baseRev", async () => {
  await reset();
  await seedSetting(2); // 乐观 rev 已漂到 2，服务端实际 rev 0
  const stored = await seedOutbox();
  await settleSettingResult(stored, 0, true);
  const setting = await localDb.settings.get([USER, KEY]);
  assert.equal(setting.rev, 0);
  const rows = await localDb.outbox.toArray();
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].operationId, stored.operationId);
  assert.equal(rows[0].baseRev, 0);
  assert.equal(rows[0].retries, 1);
  assert.equal(rows[0].payload.setting.rev, 1);
  assert.equal(rows[0].payload.setting.value.enabled, true);
});

test("settleSettingResult without requeue only aligns rev and drops the row", async () => {
  await reset();
  await seedSetting(3);
  const stored = await seedOutbox();
  await settleSettingResult(stored, 1, false);
  assert.equal((await localDb.settings.get([USER, KEY])).rev, 1);
  assert.equal(await localDb.outbox.count(), 0);
});

test("settleSettingResult stops requeueing after the retry cap", async () => {
  await reset();
  await seedSetting(2);
  const stored = await seedOutbox(2);
  await settleSettingResult(stored, 0, true);
  assert.equal((await localDb.settings.get([USER, KEY])).rev, 0);
  assert.equal(await localDb.outbox.count(), 0);
});

test("settleSettingResult keeps quiet when a newer op for the same setting is already queued", async () => {
  await reset();
  await seedSetting(2);
  const stored = await seedOutbox();
  const newer = toOutboxRow({
    operationId: crypto.randomUUID(), userId: USER, entityId: KEY, entity: "setting", action: "upsert",
    baseRev: 0, baseMetaRev: 0, payload: { setting: { userId: USER, key: KEY, sensitivity: "ordinary", value: { enabled: true }, rev: 1, updatedAt: 2 } },
  }, Date.now());
  await enqueueOutbox([newer]);
  await settleSettingResult(stored, 0, true);
  const rows = await localDb.outbox.orderBy("seq").toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operationId, newer.operationId);
  assert.equal((await localDb.settings.get([USER, KEY])).rev, 0);
});
