import type { Item, MemoComment, TopicNode } from "@menote/shared";
import { decodeBackupRow, wrapFieldToBase64 } from "@menote/shared";
import { restoreSettingRow } from "../db/backup";
import { putItemWraps, putTopicWraps } from "../db/keyWraps";
import { appendSyncLog, rowToItem, upsertItemRow, upsertTopicRow } from "../db/sync";
import { readMemoCommentState, readMemoOwnerState, rowToMemoComment, upsertMemoComment } from "../db/memoComments";

/**
 * 恢复导入服务（FR-BAK-9 工具侧）：接受备份分片条目与包装块，按 id 合并（rev 高者胜）。
 * 会话用户为归属；恢复到干净环境 = 新部署注册账号后导入。
 * 与备份推送（backupService.collectBackup/pushBackup）互为逆过程；SQL 在 db 层。
 * 包装块非法编码直接拒绝，不把对象转成垃圾字节。
 */

const MAX_IMPORT_ENTRIES = 5000;

export interface ImportContext { db: D1Database; userId: string }

export interface ImportResult {
  items: number;
  topics: number;
  memoComments: number;
  topicWraps: number;
  settings: number;
  skipped: number;
}

/** 导入备份分片：条目逐条按 kind 解析（无法识别的条目跳过），包装块按条目覆盖写入。 */
export async function importBackupEntries(
  ctx: ImportContext,
  entries: unknown[],
  itemKeyWraps: unknown[] | null,
  topicKeyWraps: unknown[] | null,
  settings: unknown[] | null,
  now: number,
): Promise<ImportResult> {
  const skipped = Math.max(0, entries.length - MAX_IMPORT_ENTRIES);
  const limited = entries.slice(0, MAX_IMPORT_ENTRIES);
  const itemWrapRows = (itemKeyWraps ?? []).map((row) => decodeBackupRow(row as Record<string, unknown>));
  const topicWrapRows = (topicKeyWraps ?? []).map((row) => decodeBackupRow(row as Record<string, unknown>));
  // 先校验包装块，避免条目已写入后才发现密钥是垃圾。
  for (const raw of [...itemWrapRows, ...topicWrapRows]) {
    wrapFieldToBase64(raw.kdf_salt);
    wrapFieldToBase64(raw.iv);
    wrapFieldToBase64(raw.ciphertext);
  }
  let items = 0;
  let topics = 0;
  let memoComments = 0;
  for (const entry of limited) {
    const record = (entry as { kind?: unknown; data?: unknown });
    if (record?.kind === "item" && typeof record.data === "object" && record.data !== null) {
      const item = rowToItem(decodeBackupRow(record.data as Record<string, unknown>)) as Item;
      await upsertItemRow(ctx.db, ctx.userId, "restore", item, item.rev, item.metaRev);
      await appendSyncLog(ctx.db, ctx.userId, "item", item.id, "upsert", item.rev, item.metaRev, now);
      items += 1;
    } else if (record?.kind === "topic" && typeof record.data === "object" && record.data !== null) {
      const topic = rowToTopic(ctx.userId, decodeBackupRow(record.data as Record<string, unknown>));
      await upsertTopicRow(ctx.db, ctx.userId, topic, topic.deletedAt);
      await appendSyncLog(ctx.db, ctx.userId, "topic", topic.id, "upsert", 0, 0, now);
      topics += 1;
    }
  }
  for (const entry of limited) {
    const record = entry as { kind?: unknown; data?: unknown };
    if (record?.kind !== "memo_comment" || typeof record.data !== "object" || record.data === null) continue;
    const comment = rowToMemoComment(decodeBackupRow(record.data as Record<string, unknown>), ctx.userId) as MemoComment;
    const owner = await readMemoOwnerState(ctx.db, ctx.userId, comment.memoId);
    if (!owner || owner.type !== "memo") continue;
    const current = await readMemoCommentState(ctx.db, ctx.userId, comment.id);
    if (!current || comment.rev > current.rev) {
      await upsertMemoComment(ctx.db, comment);
      await appendSyncLog(ctx.db, ctx.userId, "memo_comment", comment.id, comment.deletedAt === null ? "upsert" : "delete", comment.rev, 0, now);
      memoComments += 1;
    }
  }
  const wrapsByItem = groupWraps(itemWrapRows, "item_id");
  for (const [itemId, wraps] of wrapsByItem) {
    await putItemWraps(ctx.db, ctx.userId, itemId, wraps, now);
  }
  const wrapsByTopic = groupWraps(topicWrapRows, "topic_id");
  for (const [topicId, wraps] of wrapsByTopic) {
    await putTopicWraps(ctx.db, ctx.userId, topicId, wraps, now);
  }
  let restoredSettings = 0;
  for (const raw of settings ?? []) {
    if (typeof raw !== "object" || raw === null) continue;
    if (await restoreSettingRow(ctx.db, ctx.userId, decodeBackupRow(raw as Record<string, unknown>))) restoredSettings += 1;
  }
  return {
    items, topics, memoComments, topicWraps: wrapsByTopic.size, settings: restoredSettings, skipped,
  };
}

function groupWraps(rows: Array<Record<string, unknown>>, idKey: "item_id" | "topic_id") {
  const groups = new Map<string, Array<{
    wrapper: "password" | "recovery" | "topic";
    kdfSalt: string; kdfIterations: number; iv: string; ciphertext: string; generation: number;
  }>>();
  for (const raw of rows) {
    const id = String(raw[idKey] ?? "");
    if (!id) continue;
    const wrap = {
      wrapper: String(raw.wrapper) as "password" | "recovery" | "topic",
      kdfSalt: wrapFieldToBase64(raw.kdf_salt),
      kdfIterations: Number(raw.kdf_iterations),
      iv: wrapFieldToBase64(raw.iv),
      ciphertext: wrapFieldToBase64(raw.ciphertext),
      generation: Number(raw.generation ?? 0),
    };
    const list = groups.get(id) ?? [];
    list.push(wrap);
    groups.set(id, list);
  }
  return groups;
}

/** 备份中的 topic 行（snake_case）→ 主题节点；归属一律取会话用户。 */
function rowToTopic(userId: string, row: Record<string, unknown>): TopicNode {
  return {
    id: String(row.id), userId,
    parentId: row.parent_id === null || row.parent_id === undefined ? null : String(row.parent_id),
    name: String(row.name), depth: Number(row.depth) === 1 ? 1 : 0,
    isEncSpace: Number(row.is_enc_space) === 1,
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
  };
}
