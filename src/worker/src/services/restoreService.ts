import type { Item, KeyWrap, MemoComment, RecoveryCodeBinding, TopicNode } from "@menote/shared";
import { decodeBackupRow, wrapFieldToBase64 } from "@menote/shared";
import { restoreSettingStatement } from "../db/backup";
import { deleteItemWrapsStatement, itemWrapStatements, topicWrapStatements } from "../db/keyWraps";
import { appendRestoredItemLogs, appendSyncLogStatement, restoreItemRowStatements, rowToItem, upsertTopicRowStatement } from "../db/sync";
import { rowToMemoComment, upsertMemoCommentStatement } from "../db/memoComments";
import { guardRestoreItems, guardRestoreTopicWrap, readRestoreState } from "../db/restore";
import { restoreRecoveryCodeStatements } from "../db/recoveryCode";

/**
 * 恢复导入服务（FR-BAK-9 工具侧）：接受备份分片条目与包装块，按 id 合并（rev 高者胜）。
 * 会话用户为归属；恢复到干净环境 = 新部署注册账号后导入。
 * 与备份推送（backupService.collectBackup/pushBackup）互为逆过程；SQL 在 db 层。
 * 包装块非法编码直接拒绝，不把对象转成垃圾字节。
 */

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
  options: { attachmentStatements?: D1PreparedStatement[]; recoveryCodeBinding?: RecoveryCodeBinding | null } = {},
): Promise<ImportResult> {
  const itemWrapRows = (itemKeyWraps ?? []).map((row) => decodeBackupRow(row as Record<string, unknown>));
  const topicWrapRows = (topicKeyWraps ?? []).map((row) => decodeBackupRow(row as Record<string, unknown>));
  // 先校验包装块，避免条目已写入后才发现密钥是垃圾。
  for (const raw of [...itemWrapRows, ...topicWrapRows]) {
    wrapFieldToBase64(raw.kdf_salt);
    wrapFieldToBase64(raw.iv);
    wrapFieldToBase64(raw.ciphertext);
  }
  // Parse/validate the entire import before the first write. All resulting SQL statements
  // are submitted in one D1 batch, whose transaction guarantees rollback on any failure.
  const statements: D1PreparedStatement[] = [];
  const binding = options.recoveryCodeBinding;
  if (binding) statements.push(...restoreRecoveryCodeStatements(ctx.db, ctx.userId, binding));
  let items = 0;
  let topics = 0;
  let memoComments = 0;
  let skipped = 0;
  const itemRows = new Map<string, Item>();
  const topicRows = new Map<string, TopicNode>();
  const restoredCommentRows: MemoComment[] = [];
  const restoredMemoIds = new Set<string>();
  for (const entry of entries) {
    const record = entry as { kind?: unknown; data?: unknown };
    if (typeof record?.data !== "object" || record.data === null) { skipped++; continue; }
    const row = decodeBackupRow(record.data as Record<string, unknown>);
    if (record.kind === "item") {
      const item = rowToItem(row) as Item;
      if (itemRows.has(item.id)) throw new Error("invalid_duplicate_backup_item");
      itemRows.set(item.id, item);
    } else if (record.kind === "topic") {
      const topic = rowToTopic(ctx.userId, row);
      if (topicRows.has(topic.id)) throw new Error("invalid_duplicate_backup_topic");
      topicRows.set(topic.id, topic);
    } else if (record.kind === "memo_comment") {
      restoredCommentRows.push(rowToMemoComment(row, ctx.userId));
    } else skipped++;
  }

  const settingRows = (settings ?? []).filter((raw): raw is Record<string, unknown> => typeof raw === "object" && raw !== null)
    .map(decodeBackupRow);
  const itemIds = new Set(itemRows.keys());
  const commentIds = new Set<string>();
  for (const comment of restoredCommentRows) {
    itemIds.add(comment.memoId);
    commentIds.add(comment.id);
    if (comment.parentId) commentIds.add(comment.parentId);
  }
  const state = await readRestoreState(ctx.db, ctx.userId, itemIds, commentIds, new Set(settingRows.map((row) => String(row.key))));
  const wrapsByItem = groupWraps(itemWrapRows, "item_id", binding?.id);
  const restoredItems: Item[] = [];
  const itemWrapWrites: D1PreparedStatement[] = [];

  for (const topic of [...topicRows.values()].sort((a, b) => a.depth - b.depth)) {
    statements.push(upsertTopicRowStatement(ctx.db, ctx.userId, topic, topic.deletedAt));
    statements.push(appendSyncLogStatement(ctx.db, ctx.userId, "topic", topic.id, "upsert", 0, 0, now));
    topics++;
  }
  for (const item of itemRows.values()) {
    const current = state.items.get(item.id);
    if (current && (item.rev < current.rev || item.metaRev < current.meta_rev ||
      (item.rev === current.rev && (item.metaRev === current.meta_rev || item.contentHash !== current.content_hash)))) {
      skipped++;
      continue;
    }
    const replacingBody = !current || item.rev !== current.rev;
    const wraps = wrapsByItem.get(item.id) ?? [];
    if (replacingBody && item.content.scope !== "plain" && !wraps.length) throw new Error("invalid_missing_backup_item_wraps");
    if (item.type === "memo") restoredMemoIds.add(item.id);
    restoredItems.push(item);
    if (replacingBody) {
      if (current) itemWrapWrites.push(deleteItemWrapsStatement(ctx.db, ctx.userId, item.id));
      if (item.content.scope !== "plain") itemWrapWrites.push(...itemWrapStatements(ctx.db, ctx.userId, item.id, wraps, now));
    }
    items++;
  }
  statements.push(...guardRestoreItems(ctx.db, ctx.userId, restoredItems.map((item) => item.id), state.items));
  statements.push(...restoreItemRowStatements(ctx.db, ctx.userId, restoredItems));
  statements.push(...itemWrapWrites);
  statements.push(...appendRestoredItemLogs(ctx.db, ctx.userId, restoredItems, now));

  restoredCommentRows.sort((a, b) => Number(Boolean(a.parentId)) - Number(Boolean(b.parentId)) || a.createdAt - b.createdAt);
  // 回复的父评论必须在本批先写入，或已在库且结构可用；不满足则跳过该回复——
  // 分片恢复与历史级联缺口可能把父子切开，不能让单条孤儿回复
  // 触发 0038 触发器 ABORT 而回滚整批（此前整批 items/topics/settings 一并失败）。
  const writtenComments = new Map<string, { memoId: string; isRoot: boolean }>();
  for (const comment of restoredCommentRows) {
    if (comment.parentId) {
      const inBatch = writtenComments.get(comment.parentId);
      let parentAvailable = inBatch !== undefined
        && inBatch.memoId === comment.memoId && inBatch.isRoot;
      if (!parentAvailable && inBatch === undefined) {
        const parentRow = state.comments.get(comment.parentId);
        parentAvailable = parentRow !== undefined && parentRow.memo_id === comment.memoId && parentRow.parent_id === null
          && (parentRow.deleted_at === null || comment.deletedAt !== null);
      }
      if (!parentAvailable) {
        skipped += 1;
        continue;
      }
    }
    const owner = restoredMemoIds.has(comment.memoId)
      ? { type: "memo" }
      : state.items.get(comment.memoId);
    if (!owner || owner.type !== "memo") {
      skipped += 1;
      continue;
    }
    const current = state.comments.get(comment.id);
    if (current && comment.rev <= current.rev) continue;
    statements.push(upsertMemoCommentStatement(ctx.db, comment));
    statements.push(appendSyncLogStatement(ctx.db, ctx.userId, "memo_comment", comment.id,
      comment.deletedAt === null ? "upsert" : "delete", comment.rev, 0, now));
    memoComments += 1;
    writtenComments.set(comment.id, { memoId: comment.memoId, isRoot: comment.parentId === null });
  }

  const wrapsByTopic = groupWraps(topicWrapRows, "topic_id", binding?.id);
  for (const [topicId, wraps] of wrapsByTopic) {
    for (const wrap of wraps) statements.push(guardRestoreTopicWrap(ctx.db, ctx.userId, topicId, wrap));
    statements.push(...topicWrapStatements(ctx.db, ctx.userId, topicId, wraps, now));
  }

  let restoredSettings = 0;
  for (const row of settingRows) {
    const statement = restoreSettingStatement(ctx.db, ctx.userId, row);
    if (!statement) continue;
    const key = String(row.key);
    const rev = Number(row.rev ?? 0);
    const currentRev = state.settings.get(key);
    if (currentRev !== undefined && currentRev > rev) continue;
    statements.push(statement);
    restoredSettings += 1;
  }

  if (options.attachmentStatements) statements.push(...options.attachmentStatements);
  if (statements.length > 0) await ctx.db.batch(statements);
  return { items, topics, memoComments, topicWraps: wrapsByTopic.size, settings: restoredSettings, skipped };
}

function groupWraps(rows: Array<Record<string, unknown>>, idKey: "item_id" | "topic_id", fallbackCodeId?: string) {
  const groups = new Map<string, KeyWrap[]>();
  for (const raw of rows) {
    const id = String(raw[idKey] ?? "");
    if (!id) continue;
    const wrap: KeyWrap = {
      wrapper: String(raw.wrapper) as "password" | "recovery" | "topic",
      kdfSalt: wrapFieldToBase64(raw.kdf_salt),
      kdfIterations: Number(raw.kdf_iterations),
      iv: wrapFieldToBase64(raw.iv),
      ciphertext: wrapFieldToBase64(raw.ciphertext),
      generation: Number(raw.generation ?? 0),
    };
    if (wrap.wrapper === "recovery") {
      const id = typeof raw.recovery_code_id === "string" ? raw.recovery_code_id : fallbackCodeId;
      if (id) wrap.recoveryCodeId = id;
    }
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
