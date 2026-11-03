import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/cryptoService.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser",
});
const crypto1 = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("content key wrap/unwrap round-trips; wrong credential fails (G4 §2)", async () => {
  const key = crypto1.generateContentKey();
  const wrap = await crypto1.wrapContentKey(key, "单篇密码-abc-123", "password");
  assert.equal(wrap.wrapper, "password");
  assert.equal(wrap.kdfIterations, 600000);
  const unwrapped = await crypto1.unwrapContentKey(wrap, "单篇密码-abc-123");
  assert.deepEqual(Array.from(unwrapped), Array.from(key));
  await assert.rejects(crypto1.unwrapContentKey(wrap, "错误密码-xyz-987"));
});

test("markdown encrypt/decrypt round-trips with distinct IVs (C-1 密文边界)", async () => {
  const key = crypto1.generateContentKey();
  const a = await crypto1.encryptMarkdown("# 正文\n含 | 竖线与\n\n段落", key);
  const b = await crypto1.encryptMarkdown("# 正文\n含 | 竖线与\n\n段落", key);
  assert.notEqual(a.ciphertext, b.ciphertext, "同内容两次加密 IV 现生成，密文不同");
  assert.equal(await crypto1.decryptMarkdown(a, key), "# 正文\n含 | 竖线与\n\n段落");
});

test("topic key wrap uses the raw key and ignores the stored salt (G4 私人空间)", async () => {
  const itemKey = crypto1.generateContentKey();
  const topicKey = crypto1.generateContentKey();
  const wrap = await crypto1.wrapKeyWithRaw(itemKey, topicKey);
  assert.equal(wrap.wrapper, "topic");
  assert.equal(wrap.kdfIterations, 1);
  const opened = await crypto1.unwrapKeyWithRaw(wrap, topicKey);
  assert.deepEqual(Array.from(opened), Array.from(itemKey));
  await assert.rejects(crypto1.unwrapKeyWithRaw(wrap, crypto1.generateContentKey()));
});

test("recovery code format is Crockford 8x4 and unique per generation (G4 §3)", () => {
  const code = crypto1.generateRecoveryCode();
  assert.match(code, /^[0-9A-HJ-NP-TVWXYZ]{4}(-[0-9A-HJ-NP-TVWXYZ]{4}){7}$/);
  assert.equal(code.length, 39);
  assert.notEqual(code, crypto1.generateRecoveryCode());
});
