import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { installRecoveryCodeFixture } from "./recovery-code-fixture.mjs";

installRecoveryCodeFixture();

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;
const base = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({
  stdin: { contents: `export { localDb } from './src/db/localDb.ts';
    export { enforceRecoveryCode, recoveryCodeExists } from './src/services/recoveryCodeService.ts';
    export { generateContentKey, wrapContentKey } from './src/services/cryptoService.ts';`, resolveDir: base, loader: "ts" },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const { localDb, enforceRecoveryCode, recoveryCodeExists, generateContentKey, wrapContentKey } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("账户恢复码只接受与所有现存包装一致的码，缺包装时拒绝继续", async () => {
  await Promise.all(localDb.tables.map((table) => table.clear()));
  const first = await enforceRecoveryCode("a");
  assert.match(first, /^[0-9A-HJ-NP-TVWXYZ]{4}(-[0-9A-HJ-NP-TVWXYZ]{4}){7}$/);
  const another = await enforceRecoveryCode("b");
  const wrap = await wrapContentKey(generateContentKey(), first, "recovery");
  const otherWrap = await wrapContentKey(generateContentKey(), another, "recovery");
  await localDb.items.bulkPut([
    { id: "a1", userId: "a", content: { scope: "self", ciphertext: "x" } },
    { id: "b1", userId: "b", content: { scope: "self", ciphertext: "x" } },
  ]);
  await localDb.wraps.bulkPut([{ itemId: "a1", wraps: [wrap] }, { itemId: "b1", wraps: [otherWrap] }]);
  assert.equal(await recoveryCodeExists("a"), true);
  assert.equal(await enforceRecoveryCode("a", first), first);
  await assert.rejects(enforceRecoveryCode("a", another), /recovery_code_mismatch/);
  await localDb.items.put({ id: "a2", userId: "a", content: { scope: "self", ciphertext: "x" } });
  await assert.rejects(recoveryCodeExists("a"), /recovery_wrap_missing/);
  await localDb.wraps.put({ itemId: "a2", wraps: [otherWrap] });
  await assert.rejects(enforceRecoveryCode("a", first), /recovery_code_mismatch/);
  await assert.rejects(enforceRecoveryCode("a", another), /recovery_code_mismatch/);
});
