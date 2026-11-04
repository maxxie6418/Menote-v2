import type { Item, TopicNode, UserSetting } from "@menote/shared";
import type { SyncTombstone } from "@menote/shared";
import { readAllMemoComments, readMemoComments } from "./memoComments";

/** 拉取（G2 §4）：游标 = sync_log.seq；先墓碑后条目由客户端落库顺序保证。 */

export interface LogEntry {
  seq: number;
  entity: "item" | "topic" | "memo_comment";
  entityId: string;
  op: "upsert" | "delete";
}

export async function readLogPage(db: D1Database, userId: string, cursor: number, limit: number): Promise<{ entries: LogEntry[]; hasMore: boolean; oldestSeq: number | null }> {
  const rows = await db.prepare(
    "SELECT seq, entity, entity_id, op FROM sync_log WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?",
  ).bind(userId, cursor, limit + 1).all<{ seq: number; entity: string; entity_id: string; op: string }>();
  const hasMore = rows.results.length > limit;
  const page = rows.results.slice(0, limit);
  const oldest = await db.prepare("SELECT MIN(seq) AS s FROM sync_log WHERE user_id = ?").bind(userId).first<{ s: number | null }>();
  return {
    entries: page.map((row) => ({
      seq: row.seq, entity: row.entity === "topic" ? "topic" : row.entity === "memo_comment" ? "memo_comment" : "item",
      entityId: row.entity_id, op: row.op === "delete" ? "delete" : "upsert",
    })),
    hasMore,
    oldestSeq: oldest?.s ?? null,
  };
}

export function rowToItem(row: Record<string, unknown>): Item {
  const encSelf = Number(row.enc_self) === 1;
  const inEncSpace = Number(row.in_enc_space) === 1;
  const scope = encSelf ? "self" : inEncSpace ? "private_space" : "plain";
  const base = {
    id: String(row.id), userId: String(row.user_id), type: String(row.type) as Item["type"],
    topicId: (row.topic_id as string | null) ?? null, groupId: (row.group_id as string | null) ?? null,
    tags: JSON.parse(String(row.tags_json)) as string[],
    status: (row.status as Item["status"] | null) ?? null,
    attachmentHashes: JSON.parse(String(row.attachment_hashes_json)) as string[],
    source: String(row.source), rev: Number(row.rev), metaRev: Number(row.meta_rev),
    contentHash: String(row.content_hash), pinned: Number(row.pinned) === 1, starred: Number(row.starred) === 1,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
    conflictOf: row.conflict_of === null || row.conflict_of === undefined ? null : String(row.conflict_of),
  };
  const title = row.title === null || row.title === undefined ? null : String(row.title);
  if (base.type === "memo") {
    const quoteSourceId = row.memo_quote_source_id === null || row.memo_quote_source_id === undefined
      ? null : String(row.memo_quote_source_id);
    const quoteSnapshot = row.memo_quote_snapshot === null || row.memo_quote_snapshot === undefined
      ? null : String(row.memo_quote_snapshot);
    return {
      ...base, type: "memo", title, content: { scope: "plain", markdown: String(row.content_markdown ?? "") },
      ...(quoteSourceId !== null && quoteSnapshot !== null ? { memoQuote: {
        sourceMemoId: quoteSourceId, sourceCreatedAt: Number(row.memo_quote_source_created_at ?? 0), snapshot: quoteSnapshot,
      } } : {}),
    };
  }
  if (scope === "plain") {
    return { ...base, type: base.type as "note" | "table", title: title ?? "", content: { scope: "plain", markdown: String(row.content_markdown ?? "") } };
  }
  const ciphertext = row.content_ciphertext instanceof Uint8Array
    ? new TextDecoder().decode(row.content_ciphertext)
    : String(row.content_ciphertext ?? "");
  return {
    ...base, type: base.type as "note" | "table", title: title ?? "",
    content: { scope, ciphertext },
  };
}

export async function readItems(db: D1Database, userId: string, ids: string[]): Promise<Item[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT * FROM items WHERE user_id = ? AND id IN (${placeholders})`,
  ).bind(userId, ...ids).all<Record<string, unknown>>();
  return rows.results.map(rowToItem);
}

export async function readTopics(db: D1Database, userId: string, ids: string[]): Promise<TopicNode[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.prepare(
    `SELECT * FROM topic_nodes WHERE user_id = ? AND id IN (${placeholders})`,
  ).bind(userId, ...ids).all<Record<string, unknown>>();
  return rows.results.map((row) => ({
    id: String(row.id), userId: String(row.user_id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    name: String(row.name), depth: Number(row.depth) === 1 ? 1 : 0,
    isEncSpace: Number(row.is_enc_space) === 1,
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
  }));
}

export { readAllMemoComments, readMemoComments };

export function toTombstone(entry: LogEntry, userId: string, deletedAt: number): SyncTombstone {
  return { id: entry.entityId, userId, entity: entry.entity, deletedAt };
}

/** 全量重同步：按当前表状态分页（不经 sync_log）。 */
export async function readAllItemsPage(db: D1Database, userId: string, offset: number, limit: number): Promise<Item[]> {
  const rows = await db.prepare(
    "SELECT * FROM items WHERE user_id = ? ORDER BY created_at LIMIT ? OFFSET ?",
  ).bind(userId, limit, offset).all<Record<string, unknown>>();
  return rows.results.map(rowToItem);
}

export async function readAllTopics(db: D1Database, userId: string): Promise<TopicNode[]> {
  return readTopics(db, userId,
    (await db.prepare("SELECT id FROM topic_nodes WHERE user_id = ?").bind(userId).all<{ id: string }>()).results.map((row) => row.id));
}

export async function readSettings(db: D1Database, userId: string): Promise<UserSetting[]> {
  const rows = await db.prepare(
    "SELECT user_id, key, is_secret, value_json, value_ciphertext, rev FROM user_settings WHERE user_id = ?",
  ).bind(userId).all<{ user_id: string; key: string; is_secret: number; value_json: string | null; value_ciphertext: Uint8Array | ArrayBuffer | null; rev: number; updated_at: number | null }>();
  return rows.results.map((row) => ({
    userId: row.user_id,
    key: row.key,
    rev: row.rev,
    updatedAt: Number(row.updated_at ?? 0),
    ...(row.is_secret === 1
      ? { sensitivity: "secret" as const, ciphertext: row.value_ciphertext instanceof Uint8Array ? new TextDecoder().decode(row.value_ciphertext) : String(row.value_ciphertext ?? "") }
      : { sensitivity: "ordinary" as const, value: row.value_json === null ? null : JSON.parse(row.value_json) }),
  }));
}

export async function readSettingState(db: D1Database, userId: string, key: string): Promise<UserSetting | null> {
  const row = await db.prepare(
    "SELECT user_id, key, is_secret, value_json, value_ciphertext, rev, updated_at FROM user_settings WHERE user_id = ? AND key = ?",
  ).bind(userId, key).first<{ user_id: string; key: string; is_secret: number; value_json: string | null; value_ciphertext: Uint8Array | ArrayBuffer | null; rev: number; updated_at: number | null }>();
  if (!row) return null;
  return {
    userId: row.user_id, key: row.key, rev: row.rev, updatedAt: Number(row.updated_at ?? 0),
    ...(row.is_secret === 1
      ? { sensitivity: "secret" as const, ciphertext: row.value_ciphertext instanceof Uint8Array ? new TextDecoder().decode(row.value_ciphertext) : String(row.value_ciphertext ?? "") }
      : { sensitivity: "ordinary" as const, value: row.value_json === null ? null : JSON.parse(row.value_json) }),
  };
}

export async function writeSetting(db: D1Database, setting: UserSetting, baseRev: number, operationId: string, now: number): Promise<number> {
  const isSecret = setting.sensitivity === "secret";
  const write = db.prepare(
    `INSERT INTO user_settings (user_id, key, is_secret, value_json, value_ciphertext, rev, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET is_secret = excluded.is_secret,
       value_json = excluded.value_json, value_ciphertext = excluded.value_ciphertext,
       rev = excluded.rev, updated_at = excluded.updated_at
     WHERE user_settings.rev = ?`,
  ).bind(setting.userId, setting.key, isSecret ? 1 : 0,
    isSecret ? null : JSON.stringify(setting.value), isSecret ? setting.ciphertext : null,
    setting.rev, now, baseRev);
  const operation = db.prepare(
    `INSERT INTO sync_operations (user_id, operation_id, entity, entity_id, result, rev, meta_rev, content_hash, created_at)
     SELECT ?, ?, 'setting', ?, 'applied', ?, 0, NULL, ? WHERE changes() = 1`,
  ).bind(setting.userId, operationId, setting.key, setting.rev, now);
  const [result] = await db.batch([write, operation]);
  return result?.meta.changes ?? 0;
}

/* ---------- 写侧（服务层编排用；SQL 只在 db 层） ---------- */

export interface ItemState {
  rev: number; metaRev: number; contentHash: string;
  updatedAt: number; deletedAt: number | null; type: string; attachmentHashesJson: string;
}

export async function readItemState(db: D1Database, userId: string, id: string): Promise<ItemState | null> {
  const row = await db.prepare(
    "SELECT rev, meta_rev, content_hash, updated_at, deleted_at, type, attachment_hashes_json FROM items WHERE id = ? AND user_id = ?",
  ).bind(id, userId).first<{ rev: number; meta_rev: number; content_hash: string; updated_at: number; deleted_at: number | null; type: string; attachment_hashes_json: string }>();
  return row ? {
    rev: row.rev, metaRev: row.meta_rev, contentHash: row.content_hash, updatedAt: row.updated_at,
    deletedAt: row.deleted_at, type: row.type, attachmentHashesJson: row.attachment_hashes_json,
  } : null;
}

export async function readTopicDeletedAt(db: D1Database, userId: string, id: string): Promise<number | null | undefined> {
  const row = await db.prepare("SELECT deleted_at FROM topic_nodes WHERE id = ? AND user_id = ?")
    .bind(id, userId).first<{ deleted_at: number | null }>();
  return row ? row.deleted_at : undefined;
}

export async function appendSyncLog(
  db: D1Database, userId: string, entity: "item" | "topic" | "memo_comment", entityId: string,
  op: "upsert" | "delete", rev: number, metaRev: number, now: number,
): Promise<void> {
  await db.prepare(
    "INSERT INTO sync_log (user_id, entity, entity_id, op, rev, meta_rev, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(userId, entity, entityId, op, rev, metaRev, now).run();
}

export interface SyncOperationRecord {
  entity: string; entityId: string; result: string; rev: number; metaRev: number; contentHash: string | null;
}

export async function readSyncOperation(db: D1Database, userId: string, operationId: string): Promise<SyncOperationRecord | null> {
  const row = await db.prepare(
    "SELECT entity, entity_id, result, rev, meta_rev, content_hash FROM sync_operations WHERE user_id = ? AND operation_id = ?",
  ).bind(userId, operationId).first<{ entity: string; entity_id: string; result: string; rev: number; meta_rev: number; content_hash: string | null }>();
  return row ? { entity: row.entity, entityId: row.entity_id, result: row.result, rev: row.rev, metaRev: row.meta_rev, contentHash: row.content_hash } : null;
}

export async function recordSyncOperation(
  db: D1Database, userId: string, operationId: string, entity: string, entityId: string,
  result: string, rev: number, metaRev: number, contentHash: string | null, now: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO sync_operations (user_id, operation_id, entity, entity_id, result, rev, meta_rev, content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (user_id, operation_id) DO NOTHING`,
  ).bind(userId, operationId, entity, entityId, result, rev, metaRev, contentHash, now).run();
}

/** 撤销一条已知操作记录（G2 §6 幂等只覆盖已应用；rejected 记录重推前删除以重新判定）。 */
export async function deleteSyncOperation(db: D1Database, userId: string, operationId: string): Promise<void> {
  await db.prepare(
    "DELETE FROM sync_operations WHERE user_id = ? AND operation_id = ?",
  ).bind(userId, operationId).run();
}

export async function upsertItemRow(
  db: D1Database, userId: string, deviceId: string, item: Item, rev: number, metaRev: number,
): Promise<void> {
  await db.prepare(
    `INSERT INTO items (id, user_id, type, topic_id, group_id, title, content_markdown, content_ciphertext,
       tags_json, attachment_hashes_json, status, source, rev, meta_rev, content_hash, pinned, starred,
       enc_self, in_enc_space, created_at, updated_at, deleted_at, last_device, conflict_of,
       memo_quote_source_id, memo_quote_source_created_at, memo_quote_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       type = excluded.type, topic_id = excluded.topic_id, group_id = excluded.group_id, title = excluded.title,
       content_markdown = excluded.content_markdown, content_ciphertext = excluded.content_ciphertext,
       tags_json = excluded.tags_json, attachment_hashes_json = excluded.attachment_hashes_json, status = excluded.status,
       source = excluded.source, rev = MAX(rev, excluded.rev), meta_rev = MAX(meta_rev, excluded.meta_rev),
       content_hash = excluded.content_hash, pinned = excluded.pinned, starred = excluded.starred,
       updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, last_device = excluded.last_device,
       conflict_of = excluded.conflict_of,
       memo_quote_source_id = excluded.memo_quote_source_id,
       memo_quote_source_created_at = excluded.memo_quote_source_created_at, memo_quote_snapshot = excluded.memo_quote_snapshot`,
  ).bind(
    item.id, userId, item.type, item.topicId, item.groupId, item.title,
    item.content.scope === "plain" ? item.content.markdown : null,
    item.content.scope === "plain" ? null : item.content.ciphertext,
    JSON.stringify(item.tags), JSON.stringify(item.attachmentHashes), item.status, item.source,
    rev, metaRev, item.contentHash, item.pinned ? 1 : 0, item.starred ? 1 : 0,
    item.content.scope === "self" ? 1 : 0, item.content.scope === "private_space" ? 1 : 0,
    item.createdAt, item.updatedAt, item.deletedAt, deviceId, item.conflictOf ?? null,
    item.type === "memo" ? item.memoQuote?.sourceMemoId ?? null : null,
    item.type === "memo" ? item.memoQuote?.sourceCreatedAt ?? null : null,
    item.type === "memo" ? item.memoQuote?.snapshot ?? null : null,
  ).run();
}

/**
 * 正文写（窄写）：只动正文列与正文版本 rev，
 * 元数据列（标题/标签/归属/状态/形态）与 meta_rev 一律保持服务端原值。
 * 用于「客户端元数据版本落后」的正文写——元数据冲突服务端胜出（G2 §5-3），
 * 正文照常落地，不连带覆盖服务端更新的元数据。
 */
export async function updateItemContent(
  db: D1Database, userId: string, deviceId: string, item: Item, rev: number,
): Promise<void> {
  await db.prepare(
    `UPDATE items SET content_markdown = ?, content_ciphertext = ?, content_hash = ?,
       attachment_hashes_json = ?, rev = MAX(rev, ?), updated_at = ?, deleted_at = ?, last_device = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(
    item.content.scope === "plain" ? item.content.markdown : null,
    item.content.scope === "plain" ? null : item.content.ciphertext,
    item.contentHash, JSON.stringify(item.attachmentHashes), rev,
    item.updatedAt, item.deletedAt, deviceId,
    item.id, userId,
  ).run();
}

/**
 * 元数据写（标题/标签/归属/状态/形态）：只动元数据列与 meta_rev，
 * 正文列与正文版本 rev 一律不动（G2 §1：两个版本通道互不推进）。
 */
export async function updateItemMeta(
  db: D1Database, userId: string, deviceId: string, item: Item, metaRev: number,
): Promise<void> {
  await db.prepare(
    `UPDATE items SET type = ?, topic_id = ?, group_id = ?, title = ?, tags_json = ?, status = ?, source = ?,
       pinned = ?, starred = ?, memo_quote_source_id = ?, memo_quote_source_created_at = ?, memo_quote_snapshot = ?,
       meta_rev = MAX(meta_rev, ?), updated_at = ?, deleted_at = ?, last_device = ?
     WHERE id = ? AND user_id = ?`,
  ).bind(
    item.type, item.topicId, item.groupId, item.title,
    JSON.stringify(item.tags), item.status, item.source,
    item.pinned ? 1 : 0, item.starred ? 1 : 0,
    item.type === "memo" ? item.memoQuote?.sourceMemoId ?? null : null,
    item.type === "memo" ? item.memoQuote?.sourceCreatedAt ?? null : null,
    item.type === "memo" ? item.memoQuote?.snapshot ?? null : null,
    metaRev, item.updatedAt, item.deletedAt, deviceId,
    item.id, userId,
  ).run();
}

export async function markItemDeleted(
  db: D1Database, userId: string, deviceId: string, id: string, deletedAt: number,
): Promise<void> {
  await db.prepare("UPDATE items SET deleted_at = ?, last_device = ? WHERE id = ? AND user_id = ?")
    .bind(deletedAt, deviceId, id, userId).run();
}

export async function upsertTopicRow(db: D1Database, userId: string, topic: TopicNode, deletedAt: number | null): Promise<void> {
  await db.prepare(
    `INSERT INTO topic_nodes (id, user_id, parent_id, name, depth, is_enc_space, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, deleted_at = excluded.deleted_at`,
  ).bind(topic.id, userId, topic.parentId, topic.name, topic.depth, topic.isEncSpace ? 1 : 0, deletedAt).run();
}

export async function countItemReferences(db: D1Database, userId: string, sha256: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM json_each(items.attachment_hashes_json) WHERE json_each.value = ?)`,
  ).bind(userId, sha256).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function readItemAttachmentHashes(db: D1Database, userId: string, id: string): Promise<string[]> {
  const row = await db.prepare("SELECT attachment_hashes_json FROM items WHERE id = ? AND user_id = ?")
    .bind(id, userId).first<{ attachment_hashes_json: string }>();
  try {
    return JSON.parse(row?.attachment_hashes_json ?? "[]") as string[];
  } catch {
    return [];
  }
}

export async function purgeSyncOperations(db: D1Database, userId: string, before: number): Promise<void> {
  await db.prepare("DELETE FROM sync_operations WHERE user_id = ? AND created_at < ?").bind(userId, before).run();
}
