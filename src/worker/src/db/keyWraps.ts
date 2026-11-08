import { base64ToBytes, bytesToBase64, type KeyWrap } from "@menote/shared";

/** 密钥包装块存储（G7，G4 设计 §2）。b64 编码进出的转换在路由层。 */

interface WrapRow {
  wrapper: string; kdf_salt: Uint8Array; kdf_iterations: number; iv: Uint8Array;
  ciphertext: Uint8Array; generation: number;
}

function asUint8(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function toKeyWrap(row: WrapRow): KeyWrap {
  return {
    wrapper: row.wrapper as KeyWrap["wrapper"],
    kdfSalt: bytesToBase64(asUint8(row.kdf_salt)),
    kdfIterations: row.kdf_iterations,
    iv: bytesToBase64(asUint8(row.iv)),
    ciphertext: bytesToBase64(asUint8(row.ciphertext)),
    generation: row.generation,
  };
}

function fromB64(value: string): Uint8Array {
  return base64ToBytes(value);
}

export function itemWrapStatements(db: D1Database, userId: string, itemId: string, wraps: KeyWrap[], now: number): D1PreparedStatement[] {
  return wraps.map((wrap) => db.prepare(
    `INSERT INTO item_key_wraps (user_id, item_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, item_id, wrapper) DO UPDATE SET
       kdf_salt = excluded.kdf_salt, kdf_iterations = excluded.kdf_iterations,
       iv = excluded.iv, ciphertext = excluded.ciphertext, generation = excluded.generation`,
  ).bind(userId, itemId, wrap.wrapper, fromB64(wrap.kdfSalt), wrap.kdfIterations, fromB64(wrap.iv), fromB64(wrap.ciphertext), wrap.generation, now));
}

export async function putItemWraps(db: D1Database, userId: string, itemId: string, wraps: KeyWrap[], now: number): Promise<void> {
  const statements = itemWrapStatements(db, userId, itemId, wraps, now);
  if (statements.length > 0) await db.batch(statements);
}

export async function readItemWrapGroups(db: D1Database, userId: string, itemIds: string[]): Promise<Array<{ itemId: string; wraps: KeyWrap[] }>> {
  if (itemIds.length === 0) return [];
  const groups = new Map<string, KeyWrap[]>();
  for (let index = 0; index < itemIds.length; index += 90) {
    const chunk = itemIds.slice(index, index + 90);
    const rows = await db.prepare(
      `SELECT item_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation FROM item_key_wraps
       WHERE user_id = ? AND item_id IN (${chunk.map(() => "?").join(",")})`,
    ).bind(userId, ...chunk).all<WrapRow & { item_id: string }>();
    for (const row of rows.results) {
      const itemId = row.item_id;
      const group = groups.get(itemId) ?? [];
      group.push(toKeyWrap(row));
      groups.set(itemId, group);
    }
  }
  return [...groups.entries()].map(([itemId, wraps]) => ({ itemId, wraps }));
}

export function topicWrapStatements(db: D1Database, userId: string, topicId: string, wraps: KeyWrap[], now: number): D1PreparedStatement[] {
  return wraps.filter((wrap) => wrap.wrapper === "password" || wrap.wrapper === "recovery").map((wrap) => db.prepare(
    `INSERT INTO topic_key_wraps (user_id, topic_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, topic_id, wrapper) DO UPDATE SET
       kdf_salt = excluded.kdf_salt, kdf_iterations = excluded.kdf_iterations,
       iv = excluded.iv, ciphertext = excluded.ciphertext, generation = excluded.generation`,
  ).bind(userId, topicId, wrap.wrapper, fromB64(wrap.kdfSalt), wrap.kdfIterations, fromB64(wrap.iv), fromB64(wrap.ciphertext), wrap.generation, now));
}

export async function putTopicWraps(db: D1Database, userId: string, topicId: string, wraps: KeyWrap[], now: number): Promise<void> {
  const statements = topicWrapStatements(db, userId, topicId, wraps, now);
  if (statements.length > 0) await db.batch(statements);
}

export async function readTopicWrapGroups(db: D1Database, userId: string, topicIds: string[]): Promise<Array<{ topicId: string; wraps: KeyWrap[] }>> {
  if (topicIds.length === 0) return [];
  const groups = new Map<string, KeyWrap[]>();
  for (let index = 0; index < topicIds.length; index += 90) {
    const chunk = topicIds.slice(index, index + 90);
    const rows = await db.prepare(
      `SELECT topic_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation FROM topic_key_wraps
       WHERE user_id = ? AND topic_id IN (${chunk.map(() => "?").join(",")})
       ORDER BY topic_id, wrapper`,
    ).bind(userId, ...chunk).all<WrapRow & { topic_id: string }>();
    for (const row of rows.results) {
      const topicId = row.topic_id;
      const group = groups.get(topicId) ?? [];
      group.push(toKeyWrap(row));
      groups.set(topicId, group);
    }
  }
  return [...groups.entries()].map(([topicId, wraps]) => ({ topicId, wraps }));
}

export async function readTopicWraps(db: D1Database, userId: string, topicId: string): Promise<KeyWrap[]> {
  const rows = await db.prepare(
    "SELECT wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation FROM topic_key_wraps WHERE user_id = ? AND topic_id = ?",
  ).bind(userId, topicId).all<WrapRow>();
  return rows.results.map(toKeyWrap);
}

/** 移除条目全部包装块（永久删除/表格降级清理时随行）。 */
export async function deleteItemWraps(db: D1Database, userId: string, itemId: string): Promise<void> {
  await db.prepare("DELETE FROM item_key_wraps WHERE user_id = ? AND item_id = ?").bind(userId, itemId).run();
}
