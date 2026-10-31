import type { KeyWrap } from "@menote/shared";

/** 密钥包装块存储（G7，G4 设计 §2）。b64 编码进出的转换在路由层。 */

interface WrapRow {
  wrapper: string; kdf_salt: Uint8Array; kdf_iterations: number; iv: Uint8Array;
  ciphertext: Uint8Array; generation: number;
}

function toKeyWrap(row: WrapRow): KeyWrap {
  return {
    wrapper: row.wrapper as KeyWrap["wrapper"],
    kdfSalt: btoa(String.fromCharCode(...row.kdf_salt)),
    kdfIterations: row.kdf_iterations,
    iv: btoa(String.fromCharCode(...row.iv)),
    ciphertext: btoa(String.fromCharCode(...row.ciphertext)),
    generation: row.generation,
  };
}

function fromB64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export async function putItemWraps(db: D1Database, userId: string, itemId: string, wraps: KeyWrap[], now: number): Promise<void> {
  for (const wrap of wraps) {
    await db.prepare(
      `INSERT INTO item_key_wraps (user_id, item_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, item_id, wrapper) DO UPDATE SET
         kdf_salt = excluded.kdf_salt, kdf_iterations = excluded.kdf_iterations,
         iv = excluded.iv, ciphertext = excluded.ciphertext, generation = excluded.generation`,
    ).bind(userId, itemId, wrap.wrapper, fromB64(wrap.kdfSalt), wrap.kdfIterations, fromB64(wrap.iv), fromB64(wrap.ciphertext), wrap.generation, now).run();
  }
}

export async function readItemWrapGroups(db: D1Database, userId: string, itemIds: string[]): Promise<Array<{ itemId: string; wraps: KeyWrap[] }>> {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT item_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation FROM item_key_wraps
     WHERE user_id = ? AND item_id IN (${placeholders})`,
  ).bind(userId, ...itemIds).all<WrapRow & { item_id: string }>();
  const groups = new Map<string, KeyWrap[]>();
  for (const row of rows.results) {
    const itemId = row.item_id;
    const group = groups.get(itemId) ?? [];
    group.push(toKeyWrap(row));
    groups.set(itemId, group);
  }
  return [...groups.entries()].map(([itemId, wraps]) => ({ itemId, wraps }));
}

export async function putTopicWraps(db: D1Database, userId: string, topicId: string, wraps: KeyWrap[], now: number): Promise<void> {
  for (const wrap of wraps) {
    await db.prepare(
      `INSERT INTO topic_key_wraps (user_id, topic_id, wrapper, kdf_salt, kdf_iterations, iv, ciphertext, generation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, topic_id, wrapper) DO UPDATE SET
         kdf_salt = excluded.kdf_salt, kdf_iterations = excluded.kdf_iterations,
         iv = excluded.iv, ciphertext = excluded.ciphertext, generation = excluded.generation`,
    ).bind(userId, topicId, wrap.wrapper, fromB64(wrap.kdfSalt), wrap.kdfIterations, fromB64(wrap.iv), fromB64(wrap.ciphertext), wrap.generation, now).run();
  }
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
