import type { Item, TopicNode } from "@menote/shared";
import { putItemWraps } from "../db/keyWraps";
import { appendSyncLog, rowToItem, upsertItemRow, upsertTopicRow } from "../db/sync";

/**
 * 恢复导入服务（FR-BAK-9 工具侧）：接受备份分片条目与包装块，按 id 合并（rev 高者胜）。
 * 会话用户为归属；恢复到干净环境 = 新部署注册账号后导入。
 * 与备份推送（backupService.collectBackup/pushBackup）互为逆过程；SQL 在 db 层。
 */

const MAX_IMPORT_ENTRIES = 5000;

export interface ImportContext { db: D1Database; userId: string }

/** 导入备份分片：条目逐条按 kind 解析（无法识别的条目跳过），包装块按条目覆盖写入。 */
export async function importBackupEntries(
  ctx: ImportContext, entries: unknown[], itemKeyWraps: unknown[] | null, now: number,
): Promise<{ items: number; topics: number }> {
  let items = 0;
  let topics = 0;
  for (const entry of entries.slice(0, MAX_IMPORT_ENTRIES)) {
    const record = (entry as { kind?: unknown; data?: unknown });
    if (record?.kind === "item" && typeof record.data === "object" && record.data !== null) {
      const item = rowToItem(record.data as Record<string, unknown>) as Item;
      await upsertItemRow(ctx.db, ctx.userId, "restore", item, item.rev, item.metaRev);
      await appendSyncLog(ctx.db, ctx.userId, "item", item.id, "upsert", item.rev, item.metaRev, now);
      items += 1;
    } else if (record?.kind === "topic" && typeof record.data === "object" && record.data !== null) {
      const topic = rowToTopic(ctx.userId, record.data as Record<string, unknown>);
      await upsertTopicRow(ctx.db, ctx.userId, topic, topic.deletedAt);
      await appendSyncLog(ctx.db, ctx.userId, "topic", topic.id, "upsert", 0, 0, now);
      topics += 1;
    }
  }
  if (itemKeyWraps) {
    for (const raw of itemKeyWraps as Array<Record<string, unknown>>) {
      const itemId = String(raw.item_id ?? "");
      await putItemWraps(ctx.db, ctx.userId, itemId, [{
        wrapper: String(raw.wrapper) as "password",
        kdfSalt: toB64(raw.kdf_salt), kdfIterations: Number(raw.kdf_iterations), iv: toB64(raw.iv),
        ciphertext: toB64(raw.ciphertext), generation: Number(raw.generation ?? 0),
      }], now);
    }
  }
  return { items, topics };
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

/** 备份分片中的包装块字段以 b64/字节两种形态兼容（跨运行时 JSON 往返）。 */
function toB64(value: unknown): string {
  const bytes = value instanceof Uint8Array ? value : Uint8Array.from(String(value ?? ""), (char) => char.charCodeAt(0));
  return btoa(String.fromCharCode(...bytes));
}
