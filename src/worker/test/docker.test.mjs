import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { dockerBundleOptions } from "../docker/build.mjs";

test("Docker HTTP serves the Web app and preserves session and API guards", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "menote-docker-test-"));
  const instances = [];
  t.after(async () => {
    for (const { runtime, env } of instances) {
      await new Promise((done) => runtime.server.close(done));
      await runtime.drain();
      env.DB.close();
    }
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(join(directory, "index.html"), "<h1>Menote fixture</h1>");
  const { outputFiles } = await build({ ...dockerBundleOptions, entryPoints: undefined, write: false,
    stdin: { resolveDir: dockerBundleOptions.absWorkingDir, contents: [
      'export { createMenoteServer } from "./server.mjs";',
      'export { scheduledJobs } from "../src/jobs/scheduled.ts";',
      'export { openStorage } from "./storage.mjs";',
      'export { readAccountArchive, downloadAccountArchive } from "./account-archive.mjs";',
    ].join("\n") } });
  const bundle = join(directory, "server.mjs");
  await writeFile(bundle, outputFiles[0].contents);
  const { scheduledJobs, createMenoteServer, openStorage, readAccountArchive, downloadAccountArchive } = await import(pathToFileURL(bundle));
  const origin = "https://menote.example.test";
  async function start(name) {
    const env = { ...await openStorage({}, join(directory, name)), AUTH_PEPPER: "test-pepper-" + name,
      READ_ACCOUNT_ARCHIVE: readAccountArchive, DOWNLOAD_ACCOUNT_ARCHIVE: downloadAccountArchive };
    const runtime = createMenoteServer({ origin, assets: directory, ready: () => Response.json({ status: "ready" }), env });
    instances.push({ runtime, env });
    runtime.server.listen(0, "127.0.0.1");
    await once(runtime.server, "listening");
    return { url: "http://127.0.0.1:" + runtime.server.address().port, db: env.DB, env };
  }
  await assert.rejects(openStorage({ CF_D1_DATABASE_ID: "legacy" }, directory), /retired/);
  const { url, db, env: sourceEnv } = await start("source");
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

  const user = await db.prepare("SELECT id FROM users LIMIT 1").first();
  const template = { schemaVersion: 1, id: "example", name: "Article", enabled: true, exclude: [],
    match: { hosts: ["example.com"], paths: [] }, selectors: { title: { selector: "h1", value: "text" }, content: { selector: "article", value: "html" } } };
  await db.prepare("INSERT INTO clip_templates VALUES (?, ?, ?, 1, 1, 1)").bind(template.id, user.id, JSON.stringify(template)).run();
  const tableId = crypto.randomUUID();
  await db.prepare("INSERT INTO items (id,user_id,type,title,content_markdown,tags_json,attachment_hashes_json,source,rev,meta_rev,content_hash,created_at,updated_at) VALUES (?,?,'table','Bookmarks','Rows','[]','[]','manual',1,1,'hash',1,1)").bind(tableId, user.id).run();
  await db.prepare("INSERT INTO raindrop_bindings (user_id,table_item_id,collection_id,created_at,updated_at) VALUES (?,?,21,1,1)").bind(user.id, tableId).run();
  await db.prepare("INSERT INTO raindrop_sync_rows VALUES (?, 'row-one', '123', '{}', 'hash', 'synced', 1)").bind(user.id).run();
  const extraUpload = await fetch(url + "/api/attachments", { method: "POST", headers: {
    Origin: origin, Cookie: cookie, "Content-Type": "text/plain", "X-File-Extension": ".txt",
  }, body: "unreferenced attachment" });
  assert.equal(extraUpload.status, 201);
  const extraHash = (await extraUpload.json()).sha256;
  const download = await fetch(url + "/api/backup/archive/download", { method: "POST", headers: { Origin: origin, Cookie: cookie } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/zip");
  const zip = await download.arrayBuffer();
  const clean = await start("destination");
  const owner = await fetch(clean.url + "/api/auth/bootstrap", { method: "POST", headers: {
    Origin: origin, "Content-Type": "application/json",
  }, body: JSON.stringify({ username: "new-owner", password: "SeparateFixture!" }) });
  assert.equal(owner.status, 201, await owner.text());
  const restoreCookie = owner.headers.getSetCookie()[0].split(";")[0];
  for (const action of ["verify", "restore", "restore"]) {
    const result = await fetch(clean.url + "/api/backup/archive/" + action, { method: "POST",
      headers: { Origin: origin, Cookie: restoreCookie, "Content-Type": "application/zip" }, body: zip });
    const body = await result.json();
    assert.equal(result.status, 200, JSON.stringify(body));
    assert.equal(body.result.attachments, 2);
    assert.equal(body.result.templates, 1);
  }
  assert.equal((await clean.db.prepare("SELECT collection_id FROM raindrop_bindings").first()).collection_id, 21);
  assert.equal((await clean.db.prepare("SELECT raindrop_id FROM raindrop_sync_rows").first()).raindrop_id, "123");
  assert.equal(await (await fetch(clean.url + "/api/attachments/" + extraHash, { headers: { Cookie: restoreCookie } })).text(), "unreferenced attachment");
  assert.equal((await clean.db.prepare("SELECT title FROM items WHERE id=?").bind(noteId).first()).title, "Docker note");
  assert.equal((await clean.db.prepare("SELECT count(*) AS n FROM clip_templates").first()).n, 1);

  await t.test("scheduled S3 and WebDAV snapshots include all account data", async () => {
    const originalFetch = globalThis.fetch;
    const files = new Map();
    const targets = [];
    globalThis.fetch = async (url, options) => {
      const req = new Request(url, options);
      const address = new URL(req.url);
      if (!address.hostname.endsWith(".backup.test")) return originalFetch(url, options);
      if (address.hostname === "s3.backup.test") assert.match(req.headers.get("authorization"), /\/s3\/aws4_request/);
      const key = req.url;
      if (req.method === "MKCOL") return new Response(null, { status: 201 });
      if (req.method === "PUT") { files.set(key, await req.arrayBuffer()); return new Response(null); }
      if (req.method === "GET") return new Response(files.get(key), { status: files.has(key) ? 200 : 404 });
      throw new Error("unexpected backup request");
    };
    try {
      for (const kind of ["s3", "webdav"]) {
        const created = await fetch(url + "/api/backup/targets", { method: "POST",
          headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify({ kind, endpoint: "https://" + kind + ".backup.test", bucket: "backup", username: "fixture", secret: "fixture", schedule: "manual" }) });
        assert.equal(created.status, 201);
        const { id } = await created.json();
        targets.push(id);
        await db.prepare("UPDATE backup_targets SET schedule='daily' WHERE id=?").bind(id).run();
      }
      const job = scheduledJobs.find(job => job.name === "backup_push");
      await job.run(sourceEnv);
      const pushed = await db.prepare("SELECT last_pushed_at FROM backup_targets").all();
      assert.ok(pushed.results.every(row => row.last_pushed_at > 0));
      for (const [index, kind] of ["s3", "webdav"].entries()) {
        const marker = [...files.keys()].find(path => new URL(path).hostname === kind + ".backup.test" && path.endsWith("/COMPLETE"));
        assert.ok(marker);
        const id = marker.split("/").at(-2);
        const response = await fetch(url + "/api/backup/targets/" + targets[index] + "/backups/" + id + "/restore", {
          method: "POST", headers: { Origin: origin, Cookie: cookie },
        });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).attachments, 2);
        const manifest = JSON.parse(new TextDecoder().decode(files.get(marker.replace("COMPLETE", "manifest.json"))));
        assert.equal(manifest.extra.accountExtras.clipTemplates[0].id, template.id);
        assert.equal(manifest.extra.accountExtras.raindrop.rows[0].raindrop_id, "123");
      }
      const count = files.size;
      await job.run(sourceEnv);
      assert.equal(files.size, count);
    } finally { globalThis.fetch = originalFetch; }
  });
});
