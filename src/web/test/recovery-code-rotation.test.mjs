import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `export { createRecoveryCodeRotation, prepareRecoveryCodeRotation } from './src/services/recoveryCodeService.ts';
      export { generateContentKey, unwrapContentKey, wrapContentKey } from './src/services/cryptoService.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    loader: "ts",
  },
  bundle: true, format: "esm", platform: "browser", write: false,
});
const { createRecoveryCodeRotation, prepareRecoveryCodeRotation, generateContentKey, unwrapContentKey, wrapContentKey } =
  await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("merges legacy recovery codes into one without changing the encrypted content keys", async () => {
  const first = createRecoveryCodeRotation();
  const second = createRecoveryCodeRotation();
  const next = createRecoveryCodeRotation();
  const firstKey = generateContentKey();
  const secondKey = generateContentKey();
  const [firstWrap, secondWrap, verifier] = await Promise.all([
    wrapContentKey(firstKey, first.code, "recovery", 2),
    wrapContentKey(secondKey, second.code, "recovery", 5),
    wrapContentKey(generateContentKey(), first.code, "recovery"),
  ]);
  const state = {
    revision: 12, binding: { id: first.id, verifier },
    wraps: [{ kind: "item", id: "note", wrap: firstWrap }, { kind: "topic", id: "space", wrap: secondWrap }],
  };
  await assert.rejects(prepareRecoveryCodeRotation(state, [first.code], next), /recovery_code_mismatch/);
  await assert.rejects(prepareRecoveryCodeRotation({ ...state, wraps: [] }, [second.code], next), /recovery_code_mismatch/);
  const request = await prepareRecoveryCodeRotation(state, [first.code, second.code], next);

  assert.equal(request.revision, 12);
  assert.equal(request.binding.id, next.id);
  assert.deepEqual(request.wraps.map(({ kind, id, wrap }) => [kind, id, wrap.generation, wrap.recoveryCodeId]),
    [["item", "note", 3, next.id], ["topic", "space", 6, next.id]]);
  assert.deepEqual(await unwrapContentKey(request.wraps[0].wrap, next.code), firstKey);
  assert.deepEqual(await unwrapContentKey(request.wraps[1].wrap, next.code), secondKey);
  assert.equal((await unwrapContentKey(request.binding.verifier, next.code)).length, 32);
  await assert.rejects(unwrapContentKey(request.wraps[0].wrap, first.code));
  assert.ok([first, second, next].every(({ code }) => !JSON.stringify(request).includes(code)));
});
