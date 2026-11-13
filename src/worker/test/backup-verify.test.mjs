import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { build } from "esbuild";

globalThis.crypto ??= webcrypto;
const built = await build({ entryPoints: [new URL("../src/services/backupVerifyService.ts", import.meta.url).pathname.replace(/^\/(\w:)/, "$1")], bundle: true, write: false, platform: "node", format: "esm" });
const { verifyRemoteSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const id = "20261113T120000000Z-12345678";
const target = { kind: "webdav", endpoint: "https://example.invalid/dav", bucket: null, username: "u", secret: "s", remotePath: "menote", retentionCount: 0 };

test("快照校验覆盖内容篡改、附件缺失与路径越界", async () => {
  const originalFetch = globalThis.fetch;
  const shard = Buffer.from(JSON.stringify([{ kind: "item", data: { attachment_hashes_json: "[]" } }]));
  const manifest = { format: "menote-backup", version: 1, snapshotId: id, shards: [{ month: "2026-11" }], counts: { attachments: 0 }, extra: { itemKeyWraps: [], topicKeyWraps: [], settings: [] }, files: [{ path: "2026-11.json", size: shard.length, sha256: hash(shard) }] };
  const files = new Map();
  function saveManifest() { const data = Buffer.from(JSON.stringify(manifest)); files.set("manifest.json", data); files.set("COMPLETE", Buffer.from(hash(data))); }
  files.set("2026-11.json", shard); saveManifest();
  globalThis.fetch = async (url) => { const key = new URL(url).pathname.split("/").pop(); return files.has(key) ? new Response(files.get(key)) : new Response(null, { status: 404 }); };
  try {
    assert.deepEqual(await verifyRemoteSnapshot(target, id), { files: 1, shards: 1, attachments: 0 });
    files.set("2026-11.json", Buffer.from("tampered"));
    await assert.rejects(verifyRemoteSnapshot(target, id), /文件校验失败/);
    const referenced = Buffer.from(JSON.stringify([{ kind: "item", data: { attachment_hashes_json: JSON.stringify(["a".repeat(64)]) } }]));
    files.set("2026-11.json", referenced); manifest.files[0].size = referenced.length; manifest.files[0].sha256 = hash(referenced); saveManifest();
    await assert.rejects(verifyRemoteSnapshot(target, id), /缺少笔记引用的附件/);
    manifest.files[0].path = "../secret"; saveManifest();
    await assert.rejects(verifyRemoteSnapshot(target, id), /清单无效/);
  } finally { globalThis.fetch = originalFetch; }
});
