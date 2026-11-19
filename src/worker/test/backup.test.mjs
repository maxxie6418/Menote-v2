import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { Miniflare } from "miniflare";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "neutral",
  // 打包目标其实是 workerd/浏览器：不补条件时 @modelcontextprotocol/server 会解析到 node shim（node:process），
  // 整个 worker 入口打不出来，这批集成测试会集体失败。
  conditions: ["worker", "browser"], loader: { ".sql": "text" },
});
globalThis.crypto ??= webcrypto;
const backupBundle = await build({
  stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), contents: `
    export * from "./src/services/backupService";
    export { restoreRemoteSnapshot } from "./src/services/remoteRestoreService";
    export { importBackupEntries } from "./src/services/restoreService";
    export { generateRecoveryCode, generateContentKey, wrapContentKey, unwrapContentKey, encryptMarkdown, decryptMarkdown }
      from "../web/src/services/cryptoService";
    export { sealAttachment, openSealedAttachment } from "../web/src/services/sealedAttachmentService";` },
  bundle: true, write: false, format: "esm", platform: "node",
});
const backupService = await import(`data:text/javascript;base64,${Buffer.from(backupBundle.outputFiles[0].text).toString("base64")}`);

async function withWorker(run) {
  const mf = new Miniflare({ workers: [{ config: {
    name: "backup-test", compatibilityDate: "2026-10-30",
    env: { DB: { type: "d1", id: "test-backup-db" }, BUCKET: { type: "r2", name: "test-backup-bucket" }, AUTH_PEPPER: { type: "text", value: "test-only-pepper" } },
    manifest: { mainModule: "main.mjs", modules: { "main.mjs": { type: "esm", contents: bundle.outputFiles[0].text } } },
  } }] });
  try { await run(mf); } finally { await mf.dispose(); }
}
const req = (mf, path, init) => mf.dispatchFetch(`http://localhost${path}`, init);
const json = (mf, cookie, method, path, body) => req(mf, path, {
  method, headers: { "content-type": "application/json", origin: "http://localhost", cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function login(mf) {
  assert.equal((await req(mf, "/api/health/ready")).status, 200);
  const boot = await json(mf, "", "POST", "/api/auth/bootstrap", { username: "owner", password: "owner-password-1" });
  return boot.headers.get("set-cookie").split(";")[0];
}

test("备份包含回收站附件；缺失或远端读回损坏时不清理旧快照", async () => {
  await withWorker(async (mf) => {
    await login(mf);
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const content = Buffer.from("trash attachment");
    const hash = createHash("sha256").update(content).digest("hex");
    await db.prepare(`INSERT INTO items (id, user_id, type, title, content_markdown, tags_json, attachment_hashes_json, source, rev, meta_rev, content_hash, created_at, updated_at, deleted_at)
      VALUES ('trash-item', ?, 'note', '回收站', 'x', '[]', ?, 'manual', 1, 1, 'h', 1, 1, 2)`)
      .bind(user.id, JSON.stringify([hash])).run();
    const target = { kind: "webdav", endpoint: "https://example.invalid/dav", bucket: null, username: "u", secret: "s", remotePath: "menote", retentionCount: 1 };
    const ctx = { db, userId: user.id, bucket };
    const originalFetch = globalThis.fetch;
    const files = new Map();
    const calls = [];
    let corruptRead = false;
    const oldDirectory = "/dav/menote/20000101T000000000Z-00000001";
    const newerDirectory = "/dav/menote/20990101T000000000Z-00000002";
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const method = init.method ?? "GET";
      calls.push({ method, path });
      if (method === "MKCOL") return new Response(null, { status: 201 });
      if (method === "PUT") { files.set(path, new Uint8Array(init.body)); return new Response(null, { status: 201 }); }
      if (method === "GET") {
        if (corruptRead && path.endsWith(".json") && !path.endsWith("manifest.json")) return new Response("corrupt");
        return files.has(path) ? new Response(files.get(path)) : new Response(null, { status: 404 });
      }
      if (method === "PROPFIND") {
        const hrefs = path === "/dav/menote" ? [oldDirectory, newerDirectory] : [`${oldDirectory}/manifest.json`, "/dav/other/manifest.json"];
        return new Response(`<d:multistatus xmlns:d="DAV:">${hrefs.map((href) =>
          `<d:response><d:href>${href}</d:href><d:collection/></d:response>`).join("")}</d:multistatus>`, { status: 207 });
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected ${method} ${path}`);
    };
    try {
      const missing = await backupService.pushBackup(ctx, target);
      assert.equal(missing.ok, false);
      assert.match(missing.error, /引用附件缺失/);
      assert.equal(calls.length, 0, "缺附件时不访问远端，更不能删旧备份");

      await bucket.put(`${user.id}/${hash}`, content);
      const snapshot = await backupService.collectBackup(db, user.id, bucket);
      assert.equal(snapshot.attachments.length, 1, "包含仅由回收站条目引用的附件");
      corruptRead = true;
      const damaged = await backupService.pushBackup(ctx, target);
      assert.equal(damaged.ok, false);
      assert.match(damaged.error, /文件校验失败/);
      assert.equal(calls.some((call) => call.method === "DELETE" || call.method === "PROPFIND"), false, "读回校验失败不得清理旧快照");

      corruptRead = false;
      files.set(`${oldDirectory}/COMPLETE`, new Uint8Array([1]));
      files.set(`${newerDirectory}/COMPLETE`, new Uint8Array([1]));
      const complete = await backupService.pushBackup(ctx, target);
      assert.equal(complete.ok, true, "含回收站附件的快照可通过真实恢复校验器");
      assert.deepEqual(calls.filter((call) => call.method === "DELETE").map((call) => call.path),
        [`${oldDirectory}/manifest.json`, oldDirectory], "只在旧快照目录内删除，保留并发产生的更新快照");

    } finally { globalThis.fetch = originalFetch; }
  });
});

test("演练从 WebDAV 快照完整恢复 5001 条笔记及附件，并凭恢复码解密", async () => {
  await withWorker(async (source) => {
    const sourceCookie = await login(source);
    const db = await source.getD1Database("DB");
    const bucket = await source.getR2Bucket("BUCKET");
    const user = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const upload = await req(source, "/api/attachments", { method: "POST", headers: {
      origin: "http://localhost", cookie: sourceCookie, "Content-Type": "image/png", "X-File-Extension": ".png",
    }, body: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) });
    assert.equal(upload.status, 201);
    const { sha256 } = await upload.json();
    await db.prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<5000)
      INSERT INTO items (id,user_id,type,title,content_markdown,tags_json,attachment_hashes_json,source,rev,meta_rev,content_hash,created_at,updated_at)
      SELECT 'note-'||i,?,'note','Note '||i,'body','[]',CASE WHEN i=1 THEN ? ELSE '[]' END,'manual',1,1,'h',1,1 FROM n`)
      .bind(user.id, JSON.stringify([sha256])).run();
    const recovery = backupService.generateRecoveryCode();
    const key = backupService.generateContentKey();
    const oldKey = backupService.generateContentKey();
    const fixture = "随加密笔记备份的附件";
    const sealedFile = await backupService.sealAttachment(new Blob([fixture], { type: "text/plain" }), key);
    const opaqueUpload = await req(source, "/api/attachments", { method: "POST", headers: {
      origin: "http://localhost", cookie: sourceCookie, "Content-Type": sealedFile.type,
    }, body: sealedFile });
    assert.equal(opaqueUpload.status, 201, "密文上传不提供原文件扩展名");
    const { sha256: sealedHash } = await opaqueUpload.json();
    const encryptedMarkdown = `原始加密正文\n\n[附件](attachments/${sealedHash}--confidential.txt)`;
    const password = "test-note-password";
    const [body, wrap, oldWrap, passwordWrap] = await Promise.all([
      backupService.encryptMarkdown(encryptedMarkdown, key),
      backupService.wrapContentKey(key, recovery, "recovery"),
      backupService.wrapContentKey(oldKey, recovery, "recovery"),
      backupService.wrapContentKey(key, password, "password"),
    ]);
    const backupItem = (rev, envelope) => ({ id: "sealed", type: "note", title: "加密笔记", content_ciphertext: `${envelope.iv}:${envelope.ciphertext}`, tags_json: "[]",
      attachment_hashes_json: JSON.stringify([sealedHash]), source: "manual", rev, meta_rev: 1, content_hash: `encrypted-${rev}`, enc_self: 1, created_at: 1, updated_at: 1 });
    const wrapRow = (value) => ({ item_id: "sealed", wrapper: value.wrapper, kdf_salt: value.kdfSalt,
      kdf_iterations: value.kdfIterations, iv: value.iv, ciphertext: value.ciphertext, generation: value.generation });
    const created = await json(source, sourceCookie, "POST", "/api/restore", {
      entries: [{ kind: "item", data: backupItem(5, body) }], itemKeyWraps: [wrapRow(wrap), wrapRow(passwordWrap)],
    });
    assert.equal(created.status, 200);
    const codePath = `/api/recovery-code?account=${user.id}`;
    const { revision, legacyWraps } = await (await req(source, codePath, { headers: { cookie: sourceCookie } })).json();
    assert.equal(revision, 1);
    assert.equal(legacyWraps.length, 1);
    assert.deepEqual(await backupService.unwrapContentKey(legacyWraps[0], recovery), key);
    const binding = { id: crypto.randomUUID(), verifier: await backupService.wrapContentKey(backupService.generateContentKey(), recovery, "recovery") };
    const staleClaim = await json(source, sourceCookie, "POST", codePath, { revision: 0, binding });
    assert.equal(staleClaim.status, 409, "待登记时已有包装写入，旧修订号不能登记");
    const claimed = await json(source, sourceCookie, "POST", codePath, { revision, binding });
    assert.deepEqual(await claimed.json(), { binding });
    const target = { kind: "webdav", endpoint: "https://example.invalid/dav", bucket: null, username: "u", secret: "s", remotePath: "menote", retentionCount: 0 };
    const originalFetch = globalThis.fetch;
    const objects = new Map();
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      if (init.method === "MKCOL") return new Response(null, { status: 201 });
      if (init.method === "PUT") { objects.set(path, new Uint8Array(init.body)); return new Response(null, { status: 201 }); }
      return objects.has(path) ? new Response(objects.get(path)) : new Response(null, { status: 404 });
    };
    try {
      const pushed = await backupService.pushBackup({ db, userId: user.id, bucket }, target);
      assert.equal(pushed.ok, true, pushed.error);
      assert.ok([...objects.values()].every((bytes) => {
        const buffer = Buffer.from(bytes);
        return !buffer.includes(recovery) && !buffer.includes(password) && !buffer.includes("原始加密正文")
          && !buffer.includes(fixture) && !buffer.includes("confidential.txt");
      }), "快照不含恢复码、密码或加密笔记正文的明文");
      await withWorker(async (destination) => {
        const cookie = await login(destination);
        const cleanDb = await destination.getD1Database("DB");
        const cleanBucket = await destination.getR2Bucket("BUCKET");
        const cleanUser = await cleanDb.prepare("SELECT id FROM users WHERE username = 'owner'").first();
        assert.notEqual(cleanUser.id, user.id);
        const restored = await backupService.restoreRemoteSnapshot({ db: cleanDb, userId: cleanUser.id, bucket: cleanBucket }, target, pushed.backupId);
        assert.equal(restored.items, 5001);
        assert.equal(restored.attachments, 2);
        assert.equal((await cleanDb.prepare("SELECT COUNT(*) AS n FROM items").first()).n, 5001);
        const accountState = await req(destination, `/api/recovery-code?account=${cleanUser.id}`, { headers: { cookie } });
        assert.deepEqual(await accountState.json(), { binding }, "快照保留同一账户恢复码绑定");
        const stale = await json(destination, cookie, "POST", "/api/restore", { entries: [{ kind: "item", data: backupItem(2, body) }], itemKeyWraps: [wrapRow(oldWrap)] });
        assert.equal(stale.status, 200);
        assert.equal((await stale.json()).skipped, 1);
        const sealed = await cleanDb.prepare("SELECT content_ciphertext FROM items WHERE id = 'sealed'").first();
        const wraps = (await cleanDb.prepare("SELECT wrapper, kdf_salt, kdf_iterations, iv, ciphertext FROM item_key_wraps WHERE item_id = 'sealed'").all()).results;
        assert.equal(wraps.length, 2);
        const [iv, ciphertext] = sealed.content_ciphertext.split(":");
        const encryptedResponse = await req(destination, `/api/attachments/${sealedHash}`, { headers: { cookie } });
        assert.equal(encryptedResponse.headers.get("Content-Type"), sealedFile.type);
        const encryptedFile = await encryptedResponse.blob();
        await assert.rejects(backupService.openSealedAttachment(encryptedFile, oldKey));
        for (const raw of wraps) {
          const unwrapped = await backupService.unwrapContentKey({ wrapper: raw.wrapper, kdfSalt: Buffer.from(raw.kdf_salt).toString("base64"),
            kdfIterations: raw.kdf_iterations, iv: Buffer.from(raw.iv).toString("base64"), ciphertext: Buffer.from(raw.ciphertext).toString("base64") },
          raw.wrapper === "recovery" ? recovery : password);
          assert.equal(await backupService.decryptMarkdown({ iv, ciphertext }, unwrapped), encryptedMarkdown);
          const opened = await backupService.openSealedAttachment(encryptedFile, unwrapped);
          assert.equal(opened.type, "text/plain");
          assert.equal(await opened.text(), fixture);
        }
        const attachment = await req(destination, `/api/attachments/${sha256}`, { headers: { cookie } });
        assert.equal(attachment.headers.get("Content-Type"), "image/png");
        assert.equal(createHash("sha256").update(Buffer.from(await attachment.arrayBuffer())).digest("hex"), sha256);
      });
    } finally { globalThis.fetch = originalFetch; }
  });
});

test("两台设备只能登记同一恢复码，旧客户端不能另写一套包装", async () => {
  await withWorker(async (mf) => {
    const firstCookie = await login(mf);
    const loginAgain = await json(mf, "", "POST", "/api/auth/login", { username: "owner", password: "owner-password-1" });
    assert.equal(loginAgain.status, 200);
    const secondCookie = loginAgain.headers.get("set-cookie").split(";")[0];
    const db = await mf.getD1Database("DB");
    const { id: userId } = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const path = `/api/recovery-code?account=${userId}`;
    const codes = [backupService.generateRecoveryCode(), backupService.generateRecoveryCode()];
    const bindings = await Promise.all(codes.map(async (code) => ({
      id: crypto.randomUUID(), verifier: await backupService.wrapContentKey(backupService.generateContentKey(), code, "recovery"),
    })));
    const empty = await (await req(mf, path, { headers: { cookie: firstCookie } })).json();
    assert.deepEqual(empty, { binding: null, revision: 0, legacyWraps: [] });
    const attempts = await Promise.all(bindings.map((binding, index) =>
      json(mf, index ? secondCookie : firstCookie, "POST", path, { revision: 0, binding })));
    assert.deepEqual(attempts.map((response) => response.status), [200, 200]);
    const [winner, observed] = await Promise.all(attempts.map((response) => response.json()));
    assert.deepEqual(winner, observed);
    const winningIndex = bindings.findIndex((binding) => binding.id === winner.binding.id);
    assert.notEqual(winningIndex, -1);
    await assert.rejects(backupService.unwrapContentKey(winner.binding.verifier, codes[1 - winningIndex]));
    const key = backupService.generateContentKey();
    const recovery = await backupService.wrapContentKey(key, codes[winningIndex], "recovery");
    const password = await backupService.wrapContentKey(key, "single-note-test-only", "password");
    const body = await backupService.encryptMarkdown("双端同步测试", key);
    const itemId = "scoped-note";
    const stored = { id: itemId, user_id: userId, type: "note", title: "note", content_markdown: "before", tags_json: "[]",
      source: "manual", attachment_hashes_json: "[]", rev: 1, meta_rev: 1, content_hash: "old", created_at: 1, updated_at: 1 };
    assert.equal((await json(mf, firstCookie, "POST", "/api/restore", { entries: [{ kind: "item", data: stored }] })).status, 200);
    const item = { id: itemId, userId, type: "note", title: "note", topicId: null, groupId: null,
      tags: [], attachmentHashes: [], status: null, source: "manual", rev: 2, metaRev: 1, contentHash: "new",
      pinned: false, starred: false, createdAt: 1, updatedAt: 2, deletedAt: null,
      content: { scope: "self", ciphertext: `${body.iv}:${body.ciphertext}` } };
    const push = async (incoming, wraps, baseRev) => (await (await json(mf, secondCookie, "POST", "/api/sync/push", {
      deviceId: "second-device", operations: [{ operationId: crypto.randomUUID(), entityId: incoming.id, entity: "item",
        action: "upsert", baseRev, baseMetaRev: 1, contentHash: incoming.contentHash, payload: { item: incoming }, wraps }],
    })).json()).results[0];
    const old = await push(item, [password, recovery], 1);
    assert.equal(old.code, "recovery_code_binding_required");
    assert.equal((await db.prepare("SELECT enc_self FROM items WHERE id = ?").bind(itemId).first()).enc_self, 0);
    const updated = await push(item, [password, { ...recovery, recoveryCodeId: winner.binding.id }], 1);
    assert.equal(updated.result, "applied");
    // A legacy client editing an existing note can resend exactly the same recovery wrap.
    const edited = await push({ ...item, rev: 3, contentHash: "new-edit" }, [password, recovery], 2);
    assert.equal(edited.result, "applied");
    assert.equal((await db.prepare("SELECT recovery_code_id FROM item_key_wraps WHERE item_id = ? AND wrapper = 'recovery'").bind(itemId).first()).recovery_code_id, winner.binding.id);
    const wrongAccount = await req(mf, "/api/recovery-code?account=unrelated", { headers: { cookie: firstCookie } });
    assert.equal(wrongAccount.status, 409);
  });
});

test("换码原子归并多枚旧码，回收站和空间包装同步，旧包不能覆盖", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    const bucket = await mf.getR2Bucket("BUCKET");
    const { id: userId } = await db.prepare("SELECT id FROM users WHERE username = 'owner'").first();
    const path = `/api/recovery-code/rotation?account=${userId}`;
    const oldCodes = [backupService.generateRecoveryCode(), backupService.generateRecoveryCode()];
    const newCode = backupService.generateRecoveryCode();
    const wrap = backupService.wrapContentKey;
    const open = backupService.unwrapContentKey;
    const notePassword = "test-note-password";
    const noteKey = backupService.generateContentKey();
    const spaceKey = backupService.generateContentKey();
    const [noteRecovery, notePwWrap, spaceRecovery, spacePwWrap, encrypted] = await Promise.all([
      wrap(noteKey, oldCodes[0], "recovery"), wrap(noteKey, notePassword, "password"),
      wrap(spaceKey, oldCodes[1], "recovery"), wrap(spaceKey, "test-space-password", "password"),
      backupService.encryptMarkdown("保留密文与内容密钥", noteKey),
    ]);
    const item = (id, { rev = 1, deletedAt = null, conflictOf = null } = {}) => ({
      id, userId, type: "note", title: id, topicId: null, groupId: null, tags: [], attachmentHashes: [], status: null,
      source: "manual", rev, metaRev: 1, contentHash: `body-${rev}`, pinned: false, starred: false,
      createdAt: 1, updatedAt: rev, deletedAt, conflictOf,
      content: { scope: "self", ciphertext: `${encrypted.iv}:${encrypted.ciphertext}` },
    });
    const itemOp = (input, wraps) => ({
      operationId: crypto.randomUUID(), entityId: input.id, entity: "item", action: "upsert",
      baseRev: input.rev - 1, baseMetaRev: 1, contentHash: input.contentHash, payload: { item: input }, wraps,
    });
    const push = async (...operations) => (await (await json(mf, cookie, "POST", "/api/sync/push", {
      deviceId: "device", operations,
    })).json()).results;
    const [trash, purged, stale, topic] = ["trash-note", "purged-note", "old-wrap-note", "space"];
    const owner = { id: topic, userId, name: "空间", parentId: null, depth: 0, isEncSpace: true, deletedAt: null };
    const seeded = await push(
      itemOp(item(trash, { deletedAt: 2 }), [notePwWrap, noteRecovery]),
      itemOp(item(purged, { deletedAt: 2 }), [notePwWrap, noteRecovery]),
      itemOp(item(stale), [notePwWrap, noteRecovery]),
      { operationId: crypto.randomUUID(), entityId: topic, entity: "topic", action: "upsert", baseRev: 0, baseMetaRev: 0,
        payload: { topic: owner }, wraps: [spacePwWrap, spaceRecovery] },
    );
    assert.deepEqual(seeded.map(({ result }) => result), ["applied", "applied", "applied", "applied"]);
    // Simulate legacy leftovers from a decrypted note and a previously interrupted space setup.
    await db.batch([
      db.prepare("UPDATE items SET enc_self = 0, content_ciphertext = NULL, content_markdown = 'clear' WHERE id = ?").bind(stale),
      db.prepare("INSERT INTO topic_nodes (id, user_id, name, depth, is_enc_space) VALUES ('empty-placeholder', ?, '空间', 0, 1)").bind(userId),
    ]);
    await db.prepare(`INSERT INTO topic_key_wraps (user_id, topic_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, created_at)
      SELECT user_id, 'empty-placeholder', wrapper, kdf_salt, kdf_iterations, iv, ciphertext, created_at
      FROM topic_key_wraps WHERE user_id = ? AND topic_id = ? AND wrapper = 'password'`).bind(userId, topic).run();
    const missing = await json(mf, cookie, "GET", path);
    assert.deepEqual([missing.status, await missing.json()], [409, { error: "recovery_code_wrap_missing" }]);
    await db.prepare("DELETE FROM topic_key_wraps WHERE user_id = ? AND topic_id = 'empty-placeholder'").bind(userId).run();
    const getState = async () => {
      const state = await json(mf, cookie, "GET", path);
      assert.equal(state.status, 200);
      assert.equal(state.headers.get("Cache-Control"), "no-store");
      return await state.json();
    };
    assert.equal((await json(mf, cookie, "GET", "/api/recovery-code/rotation?account=other")).status, 409);
    const binding = { id: crypto.randomUUID(), verifier: await wrap(backupService.generateContentKey(), newCode, "recovery") };
    const replacement = async ({ kind, id, wrap: prior }) => ({
      kind, id, wrap: { ...await wrap(kind === "item" ? noteKey : spaceKey, newCode, "recovery", prior.generation + 1), recoveryCodeId: binding.id },
    });
    const before = await getState();
    assert.equal(before.binding, null);
    assert.deepEqual(before.wraps.map(({ id }) => id), [purged, trash, topic]);
    const replacements = await Promise.all(before.wraps.map(replacement));
    const partial = await json(mf, cookie, "POST", path, { binding, revision: before.revision, wraps: replacements.slice(1) });
    assert.deepEqual([partial.status, await partial.json()], [409, { error: "recovery_code_revision_changed" }]);
    await db.batch([
      db.prepare("DELETE FROM items WHERE id = ?").bind(purged),
      db.prepare("DELETE FROM item_key_wraps WHERE item_id = ?").bind(purged),
    ]);
    assert.equal((await json(mf, cookie, "POST", path, { binding, revision: before.revision, wraps: replacements })).status, 409);
    const afterPurge = await getState();
    assert.ok(afterPurge.revision > before.revision);
    assert.deepEqual(afterPurge.wraps.map(({ id }) => id), [trash, topic]);
    const oldSnapshot = await backupService.collectBackup(db, userId, bucket);
    const request = { binding, revision: afterPurge.revision, wraps: replacements.slice(1) };
    const { seq } = await db.prepare("SELECT MAX(seq) AS seq FROM sync_log WHERE user_id = ?").bind(userId).first();
    const responses = await Promise.all([json(mf, cookie, "POST", path, request), json(mf, cookie, "POST", path, request)]);
    assert.deepEqual(responses.map(({ status }) => status).sort(), [200, 409]);
    const committed = await getState();
    assert.deepEqual(committed.binding, binding);
    assert.deepEqual(committed.wraps, request.wraps);
    assert.equal(committed.revision, afterPurge.revision + 3, "绑定和两个包装块各记一次修订");

    const sync = await json(mf, cookie, "GET", `/api/sync/pull?cursor=${seq}`);
    assert.equal(sync.status, 200);
    const page = await sync.json();
    assert.deepEqual(page.items.map(({ id, deletedAt, rev }) => [id, deletedAt, rev]), [[trash, 2, 1]]);
    assert.deepEqual(page.topics.map(({ id }) => id), [topic]);
    assert.deepEqual(page.wraps[0].wraps.find(({ wrapper }) => wrapper === "password"), notePwWrap);
    assert.deepEqual(page.topicWraps[0].wraps.find(({ wrapper }) => wrapper === "password"), spacePwWrap);
    for (const [index, { wrap: next }] of committed.wraps.entries()) {
      assert.deepEqual(await open(next, newCode), index === 0 ? noteKey : spaceKey);
      await assert.rejects(open(next, oldCodes[index]));
    }
    const attemptedReplay = await push(
      itemOp(item(trash, { rev: 2, deletedAt: 2 }), [notePwWrap, noteRecovery]),
      itemOp(item("stale-conflict", { conflictOf: stale }), [notePwWrap, noteRecovery]),
    );
    assert.deepEqual(attemptedReplay.map(({ code }) => code), ["recovery_code_binding_required", "recovery_code_binding_required"]);
    assert.deepEqual(await db.prepare("SELECT id, rev, content_hash FROM items WHERE id = ? OR id = 'stale-conflict'").bind(trash).all()
      .then(({ results }) => results), [{ id: trash, rev: 1, content_hash: "body-1" }]);
    assert.deepEqual(await getState(), committed);

    const snap = await backupService.collectBackup(db, userId, bucket);
    const { recoveryCodeBinding, itemKeyWraps, topicKeyWraps } = snap.manifest.extra;
    assert.deepEqual(recoveryCodeBinding, binding);
    assert.deepEqual(itemKeyWraps.map((row) => row.item_id), [trash, trash]);
    assert.ok([...itemKeyWraps, ...topicKeyWraps].filter(({ wrapper }) => wrapper === "recovery")
      .every((row) => row.recovery_code_id === binding.id));
    const restore = (destination, snapshot) => {
      const extra = snapshot.manifest.extra;
      return backupService.importBackupEntries(destination, Object.values(snapshot.months).flat(), extra.itemKeyWraps,
        extra.topicKeyWraps, extra.settings, Date.now(), { recoveryCodeBinding: extra.recoveryCodeBinding });
    };
    await assert.rejects(restore({ db, userId }, oldSnapshot));
    assert.deepEqual(await getState(), committed);
    await withWorker(async (destination) => {
      const destinationCookie = await login(destination);
      const destinationDb = await destination.getD1Database("DB");
      const { id: destinationId } = await destinationDb.prepare("SELECT id FROM users WHERE username = 'owner'").first();
      await restore({ db: destinationDb, userId: destinationId }, snap);
      const restored = await json(destination, destinationCookie, "GET", `/api/recovery-code/rotation?account=${destinationId}`);
      assert.equal(restored.status, 200);
      const state = await restored.json();
      assert.deepEqual(state.binding, binding);
      assert.deepEqual(state.wraps, committed.wraps);
    });
  });
});

test("backup target CRUD with reversible secret storage and reveal (FR-BAK-1, C-7)", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const created = await json(mf, cookie, "POST", "/api/backup/targets", {
      kind: "webdav", endpoint: "https://dav.example.invalid/dav", username: "user", secret: "secret-value-123", schedule: "daily", name: "主备份",
    });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const list = await (await json(mf, cookie, "GET", "/api/backup/targets")).json();
    assert.equal(list.targets.length, 1);
    assert.equal(list.targets[0].name, "主备份");
    assert.match(list.targets[0].secretCiphertext, /^[A-Za-z0-9+/=]+$/);
    assert.equal(list.targets[0].secretCiphertext.includes("secret-value-123"), false, "明文凭据不入库");
    const revealed = await (await json(mf, cookie, "GET", `/api/backup/targets/${id}/secret`)).json();
    assert.equal(revealed.secret, "secret-value-123");
    // 停用后 run 被拒（409）
    assert.equal((await json(mf, cookie, "PATCH", `/api/backup/targets/${id}`, { enabled: false })).status, 200);
    assert.equal((await json(mf, cookie, "POST", `/api/backup/run/${id}`)).status, 409);
    // 隔离：另一 cookie 看不到
    const second = await json(mf, cookie, "POST", "/api/auth/registration", { open: true });
    assert.equal(second.status, 200);
    const reg = await json(mf, cookie, "POST", "/api/auth/register", { username: "alice", password: "alice-password-1" });
    const aliceCookie = reg.headers.get("set-cookie").split(";")[0];
    const aliceList = await (await json(mf, aliceCookie, "GET", "/api/backup/targets")).json();
    assert.equal(aliceList.targets.length, 0, "备份目标按用户隔离（FR-USR-2）");
  });
});

test("restore import merges backup entries by id (FR-BAK-9 工具侧)", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const entries = [
      { kind: "topic", data: { id: "t1", user_id: "x", parent_id: null, name: "恢复主题", depth: 0, is_enc_space: 0, deleted_at: null, created_at: 1_700_000_000_000 } },
      { kind: "item", data: { id: "ri1", user_id: "x", type: "note", topic_id: null, group_id: null, title: "恢复的笔记", content_markdown: "恢复正文", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 3, meta_rev: 1, content_hash: "h1", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1_700_000_000_000, updated_at: 1_700_000_000_000, deleted_at: null } },
    ];
    const response = await json(mf, cookie, "POST", "/api/restore", { entries, itemKeyWraps: [] });
    assert.deepEqual(await response.json(), { ok: true, items: 1, topics: 1, memoComments: 0, topicWraps: 0, settings: 0, skipped: 0 });
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    assert.equal(page.items.find((item) => item.id === "ri1").title, "恢复的笔记");
    assert.equal(page.topics.find((topic) => topic.id === "t1").name, "恢复主题");
  });
});

test("restore imports Memo comments together with their Memo owner atomically", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const response = await json(mf, cookie, "POST", "/api/restore", { entries: [
      { kind: "item", data: { id: "restore-memo", type: "memo", topic_id: null, group_id: null, title: null, content_markdown: "memo body", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 1, meta_rev: 0, content_hash: "memo-hash", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
      { kind: "memo_comment", data: { id: "restore-comment", user_id: "x", memo_id: "restore-memo", content_markdown: "comment", rev: 1, created_at: 1, updated_at: 1, deleted_at: null } },
    ] });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).memoComments, 1);
    const db = await mf.getD1Database("DB");
    const comment = await db.prepare("SELECT content_markdown FROM memo_comments WHERE id = 'restore-comment'").first();
    assert.equal(comment.content_markdown, "comment");
  });
});

test("restore import rolls back all rows if any batched write fails", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const db = await mf.getD1Database("DB");
    await db.exec("CREATE TRIGGER fail_restore_log BEFORE INSERT ON sync_log WHEN NEW.entity_id = 'atomic-item' BEGIN SELECT RAISE(FAIL, 'injected restore failure'); END;");
    const entries = [
      { kind: "item", data: { id: "atomic-item", type: "note", topic_id: null, group_id: null, title: "atomic", content_markdown: "body", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 1, meta_rev: 0, content_hash: "h", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
    ];
    const response = await json(mf, cookie, "POST", "/api/restore", { entries });
    assert.equal(response.status, 400);
    const item = await db.prepare("SELECT id FROM items WHERE id = 'atomic-item'").first();
    assert.equal(item, null, "the D1 batch must roll back the row written before the failing log insert");
  });
});

test("restore rejects garbage key wraps and accepts explicit base64", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const entries = [
      { kind: "item", data: { id: "enc1", user_id: "x", type: "note", topic_id: null, group_id: null, title: "加密", content_markdown: null, content_ciphertext: { $b64: btoa("iv:cipher") }, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 2, meta_rev: 1, content_hash: "h", pinned: 0, starred: 0, enc_self: 1, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
    ];
    const bad = await json(mf, cookie, "POST", "/api/restore", {
      entries,
      itemKeyWraps: [{ item_id: "enc1", wrapper: "password", kdf_salt: { not: "bytes" }, kdf_iterations: 1, iv: "aaaa", ciphertext: "aaaa", generation: 0 }],
    });
    assert.equal(bad.status, 400);
    const salt = btoa("salt-bytes");
    const iv = btoa("iv-bytes-12!");
    const sealed = btoa("cipher-bytes");
    const good = await json(mf, cookie, "POST", "/api/restore", {
      entries,
      itemKeyWraps: [{ item_id: "enc1", wrapper: "password", kdf_salt: { $b64: salt }, kdf_iterations: 1, iv: { $b64: iv }, ciphertext: { $b64: sealed }, generation: 1 }],
      topicKeyWraps: [{ topic_id: "space", wrapper: "password", kdf_salt: { $b64: salt }, kdf_iterations: 1, iv: { $b64: iv }, ciphertext: { $b64: sealed }, generation: 1 }],
    });
    assert.equal(good.status, 200);
    const body = await good.json();
    assert.equal(body.skipped, 0);
    assert.equal(body.topicWraps, 1);
    const page = await (await req(mf, "/api/sync/pull?cursor=0", { headers: { cookie } })).json();
    const item = page.items.find((row) => row.id === "enc1");
    assert.equal(item.content.ciphertext, "iv:cipher");
    assert.equal(page.wraps.find((group) => group.itemId === "enc1").wraps[0].kdfSalt, salt);
  });
});

test("restore skips orphaned replies instead of failing the whole batch", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const response = await json(mf, cookie, "POST", "/api/restore", { entries: [
      { kind: "item", data: { id: "orphan-memo", type: "memo", topic_id: null, group_id: null, title: null, content_markdown: "memo", content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev: 1, meta_rev: 0, content_hash: "h", pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null } },
      { kind: "memo_comment", data: { id: "orphan-root", user_id: "x", memo_id: "orphan-memo", content_markdown: "root", rev: 1, created_at: 1, updated_at: 1, deleted_at: null } },
      { kind: "memo_comment", data: { id: "orphan-reply", user_id: "x", memo_id: "orphan-memo", parent_id: "missing-parent", content_markdown: "reply", rev: 1, created_at: 2, updated_at: 2, deleted_at: null } },
    ] });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.memoComments, 1, "根评论正常导入");
    assert.equal(body.skipped, 1, "孤儿回复跳过并计数");
    const db = await mf.getD1Database("DB");
    const reply = await db.prepare("SELECT id FROM memo_comments WHERE id = 'orphan-reply'").first();
    assert.equal(reply, null);
    const root = await db.prepare("SELECT content_markdown FROM memo_comments WHERE id = 'orphan-root'").first();
    assert.equal(root.content_markdown, "root");
  });
});

test("restore does not roll newer content back to an older backup revision", async () => {
  await withWorker(async (mf) => {
    const cookie = await login(mf);
    const row = (rev, markdown) => ({ id: "rev-item", type: "note", topic_id: null, group_id: null, title: "t", content_markdown: markdown, content_ciphertext: null, tags_json: "[]", attachment_hashes_json: "[]", status: null, source: "manual", rev, meta_rev: 0, content_hash: `h-${markdown}`, pinned: 0, starred: 0, enc_self: 0, in_enc_space: 0, created_at: 1, updated_at: 1, deleted_at: null });
    await json(mf, cookie, "POST", "/api/restore", { entries: [{ kind: "item", data: row(5, "新版正文") }] });
    const second = await json(mf, cookie, "POST", "/api/restore", { entries: [{ kind: "item", data: row(3, "旧版正文") }] });
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { ok: true, items: 0, topics: 0, memoComments: 0, topicWraps: 0, settings: 0, skipped: 1 });
    const db = await mf.getD1Database("DB");
    const item = await db.prepare("SELECT content_markdown, rev FROM items WHERE id = 'rev-item'").first();
    assert.deepEqual(item, { content_markdown: "新版正文", rev: 5 });
    const third = await json(mf, cookie, "POST", "/api/restore", { entries: [{ kind: "item", data: row(6, "更新后的正文") }] });
    assert.equal(third.status, 200);
    assert.equal((await third.json()).items, 1);
    assert.deepEqual(await db.prepare("SELECT content_markdown, rev FROM items WHERE id = 'rev-item'").first(),
      { content_markdown: "更新后的正文", rev: 6 });
  });
});
