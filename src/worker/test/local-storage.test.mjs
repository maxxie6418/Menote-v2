import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDatabase } from "../docker/local-db.mjs";
import { LocalBucket } from "../docker/local-bucket.mjs";

test("local SQLite applies migration scripts atomically and reopens existing rows", async t => {
  const dir = await mkdtemp(join(tmpdir(), "menote-sqlite-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const schema = "CREATE TABLE docs (id INTEGER PRIMARY KEY, body BLOB); CREATE INDEX doc_body ON docs(body)";
  const file = join(dir, "menote.sqlite");
  let db = new LocalDatabase(file, [schema]);
  try {
    await db.batch([db.prepare(schema)]);
    const insert = db.prepare("INSERT INTO docs VALUES (?, ?)");
    const bytes = Uint8Array.of(0, 255);
    const [, check] = await db.batch([insert.bind(1, bytes), db.prepare("SELECT changes() AS n")]);
    assert.equal(check.results[0].n, 1);
    await assert.rejects(db.batch([insert.bind(2, bytes), insert.bind(1, bytes)]));
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM docs").first("n"), 1);
    db.close();
    db = new LocalDatabase(file, [schema]);
    assert.deepEqual(await db.prepare("SELECT body FROM docs").first("body"), bytes);
  } finally { db.close(); }
});

test("filesystem objects keep streamed bytes, prefix pagination and deletes across reopen", async t => {
  const dir = await mkdtemp(join(tmpdir(), "menote-objects-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const objects = join(dir, "objects"), staging = join(dir, "staging");
  await Promise.all([mkdir(objects), mkdir(staging)]);
  const bucket = new LocalBucket(objects, staging);
  await bucket.put("account/a", new Blob(["abc"]).stream());
  await bucket.put("account/b", "second");
  const reopened = new LocalBucket(objects, staging);
  const page = await reopened.list({ prefix: "account/", limit: 1 });
  assert.equal(page.objects[0].key, "account/a");
  assert.equal(page.truncated, true);
  assert.equal((await reopened.list({ prefix: "account/", cursor: page.cursor })).objects[0].key, "account/b");
  assert.equal(await new Response((await reopened.get("account/a")).body).text(), "abc");
  await reopened.delete(["account/a", "account/b"]);
  assert.equal(await reopened.head("account/a"), null);
});
