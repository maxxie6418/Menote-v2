import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { dockerBundleOptions } from "../docker/build.mjs";
import { D1HttpDatabase } from "../docker/d1.mjs";
import { R2S3Bucket } from "../docker/r2.mjs";

test("Docker D1 converts blobs and keeps a batch in a single request", async () => {
  const calls = [];
  const db = new D1HttpDatabase("test-account", "test-database", "test-token", async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return Response.json({ success: true, result: [
      { success: true, results: [], meta: { changes: 0 } },
      { success: true, results: [], meta: { changes: 1 } },
      { success: true, results: [{ content: [0, 255], previous_changes: 1 }], meta: { changes: 0 } },
    ] });
  });
  const seed = Uint8Array.from([4, 0, 255, 9]);
  const result = await db.batch([
    db.prepare("CREATE TABLE first (v BLOB); CREATE TABLE second (v BLOB)"),
    db.prepare("SELECT ?, ?, ?").bind(seed.subarray(1, 3), null, 42),
  ]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].batch[1].params, [[0, 255], null, 42]);
  assert.deepEqual(result[2].results[0].content, Uint8Array.from([0, 255]));
  assert.equal(result[2].results[0].previous_changes, 1);
});

test("Docker D1 surfaces a failed batch without retrying writes", async () => {
  let calls = 0;
  const db = new D1HttpDatabase("test-account", "test-database", "test-token", async () => {
    calls++;
    return Response.json({ success: false, result: [] });
  });
  await assert.rejects(db.batch([db.prepare("UPDATE example SET value = ?").bind(1)]), /D1 query failed/);
  assert.equal(calls, 1);
});

test("Docker R2 keeps existing object keys and reads encoded list results", async () => {
  const calls = [];
  const bucket = new R2S3Bucket({ accountId: "test-account", bucket: "test-bucket" }, {
    async fetch(url, init) {
      calls.push([new URL(url), init.method]);
      if (new URL(url).searchParams.has("list-type")) {
        return new Response("<ListBucketResult><IsTruncated>false</IsTruncated><Contents>" +
          "<Key>user%2Ffile%20%26%20name</Key><Size>4</Size></Contents></ListBucketResult>");
      }
      return new Response(init.method === "GET" ? "test" : null, { headers: { "Content-Length": "4" } });
    },
  });
  const key = "user/file & name";
  assert.equal((await bucket.head(key)).size, 4);
  assert.equal(await new Response((await bucket.get(key)).body).text(), "test");
  assert.deepEqual((await bucket.list({ prefix: "user/" })).objects, [{ key, size: 4 }]);
  await bucket.put(key, new Uint8Array([1]));
  await bucket.delete([key]);
  assert.equal(decodeURIComponent(calls[0][0].pathname), "/test-bucket/user/file & name");
  assert.equal(calls[2][0].searchParams.get("prefix"), "user/");
  assert.deepEqual(calls.map(([, method]) => method), ["HEAD", "GET", "GET", "PUT", "DELETE"]);
});

test("Docker HTTP serves the Web app and preserves session and API guards", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "menote-docker-test-"));
  const mf = new Miniflare({ workers: [{ config: {
    name: "docker-test", compatibilityDate: "2026-10-30",
    env: { DB: { type: "d1", id: "test-docker-db" }, BUCKET: { type: "r2", name: "test-docker-bucket" } },
    manifest: { mainModule: "main.mjs", modules: {
      "main.mjs": { type: "esm", contents: "export default { fetch() { return new Response('test'); } }" },
    } },
  } }] });
  let runtime;
  t.after(async () => {
    if (runtime) {
      await new Promise((done) => runtime.server.close(done));
      await runtime.drain();
    }
    await mf.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(join(directory, "index.html"), "<h1>Menote fixture</h1>");
  const { outputFiles } = await build({ ...dockerBundleOptions, write: false });
  const bundle = join(directory, "server.mjs");
  await writeFile(bundle, outputFiles[0].contents);
  const { createMenoteServer } = await import(pathToFileURL(bundle));
  const origin = "https://menote.example.test";
  runtime = createMenoteServer({
    origin, assets: directory, ready: () => Response.json({ status: "ready" }),
    env: { AUTH_PEPPER: "isolated-docker-fixture", DB: await mf.getD1Database("DB"), BUCKET: await mf.getR2Bucket("BUCKET") },
  });
  const { server } = runtime;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const url = "http://127.0.0.1:" + server.address().port;
  assert.match(await (await fetch(url + "/notes")).text(), /Menote fixture/);
  assert.equal((await fetch(url + "/api/unknown")).status, 404);
  assert.equal((await fetch(url + "/api/health/live")).status, 200);

  const credentials = JSON.stringify({ username: "docker-owner", password: "DockerFixture2026!" });
  const response = await fetch(url + "/api/auth/bootstrap", {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: credentials,
  });
  assert.equal(response.status, 201);
  const session = response.headers.getSetCookie()[0];
  assert.match(session, /Secure/);
  assert.match(session, /SameSite=Strict/);
  await response.arrayBuffer();
  const cookie = session.split(";")[0];
  assert.equal((await fetch(url + "/api/auth/me", { headers: { Cookie: cookie } })).status, 200);
  const crossOrigin = await fetch(url + "/api/auth/logout", {
    method: "POST", headers: { Origin: "https://other.example.test", Cookie: cookie },
  });
  assert.equal(crossOrigin.status, 403);

  const payload = new Uint8Array([72, 105, 33]);
  const upload = await fetch(url + "/api/attachments", {
    method: "POST", headers: {
      Origin: origin, Cookie: cookie, "Content-Type": "text/plain", "X-File-Extension": ".txt",
    }, body: payload,
  });
  assert.equal(upload.status, 201);
  const { sha256 } = await upload.json();
  const attachment = await fetch(url + "/api/attachments/" + sha256, { headers: { Cookie: cookie } });
  assert.equal(attachment.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await attachment.arrayBuffer()), payload);
  const noteId = crypto.randomUUID();
  const operation = {
    operationId: crypto.randomUUID(), entityId: noteId, entity: "item", action: "upsert",
    userId: "ignored", baseRev: 0, baseMetaRev: 0, contentHash: "fixture-hash", attachmentRefs: [sha256],
    payload: { item: {
      id: noteId, userId: "ignored", type: "note", topicId: null, groupId: null, title: "Docker note",
      tags: [], status: null, attachmentHashes: [sha256], source: "manual", rev: 1, metaRev: 1,
      contentHash: "fixture-hash", pinned: false, starred: false, createdAt: Date.now(),
      updatedAt: Date.now(), deletedAt: null, content: { scope: "plain", markdown: "Docker fixture" },
    } },
  };
  const push = await fetch(url + "/api/sync/push", {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: "docker-device", operations: [operation] }),
  });
  assert.equal((await push.json()).results[0].result, "applied");
  const pull = await fetch(url + "/api/sync/pull?cursor=0", { headers: { Cookie: cookie } });
  assert.ok((await pull.json()).items.some((item) => item.id === noteId));
});
