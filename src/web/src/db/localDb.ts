import Dexie, { type Table } from "dexie";
import type { Item, KeyWrap, MemoComment, TopicNode, UserSetting } from "@menote/shared";
import type { SyncEntity } from "@menote/shared";

/** 本地运行时权威副本（主文档 6.1：IndexedDB 权威 + D1 同步权威）。
 *  字段与 shared 契约单源对齐；加密条目本地同样只存密文（FR-ENC-5）。 */

export interface OutboxRow {
  seq?: number;
  userId: string;
  operationId: string;
  entityId: string;
  entity: SyncEntity;
  action: "upsert" | "delete";
  baseRev: number;
  baseMetaRev: number;
  contentHash?: string;
  attachmentRefs?: string[];
  payload: unknown;
  /** 加密条目：随操作推送的包装块（G7）。 */
  wraps?: KeyWrap[];
  queuedAt: number;
  retries: number;
  nextRetryAt: number | null;
  lastError: string | null;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/** 本机同步诊断事件：只含操作元数据，不写笔记内容、标题、附件名或密钥。 */
export interface SyncDiagnosticRow {
  id?: number;
  userId: string;
  at: number;
  category: "local" | "cycle" | "push" | "pull" | "conflict" | "error";
  event: string;
  entity?: string;
  entityId?: string;
  action?: string;
  operationId?: string;
  baseRev?: number;
  baseMetaRev?: number;
  serverRev?: number;
  serverMetaRev?: number;
  result?: string;
  code?: string;
  cursor?: number;
  nextCursor?: number;
  count?: number;
  durationMs?: number;
  retryCount?: number;
  deviceId?: string;
}

export interface WrapRow {
  itemId: string;
  wraps: KeyWrap[];
}

/** 私人空间主题密钥包装（K_topic：空间密码 + 恢复码）。 */
export interface TopicWrapRow {
  topicId: string;
  wraps: KeyWrap[];
}

/** 版本快照（G8，FR-VER-1）：封存写入前的一份全文；加密条目只存密文（FR-VER-5）。 */
export interface VersionRow {
  id?: number;
  itemId: string;
  userId: string;
  title: string;
  /** plain 作用域存 Markdown；加密条目存信封字符串（FR-VER-5 只存密文）。 */
  content: string;
  scope: "plain" | "sealed";
  rev: number;
  reason: "autosave" | "session" | "restore" | "manual";
  createdAt: number;
}

/** E1 表集；版本历史（G8）与同步游标推进（G6）随对应工作项扩展。 */
class MenoteLocalDb extends Dexie {
  topics!: Table<TopicNode, string>;
  items!: Table<Item, string>;
  memoComments!: Table<MemoComment, string>;
  settings!: Table<UserSetting, [string, string]>;
  outbox!: Table<OutboxRow, number>;
  wraps!: Table<WrapRow, string>;
  topicWraps!: Table<TopicWrapRow, string>;
  versions!: Table<VersionRow, number>;
  meta!: Table<MetaRow, string>;
  syncDiagnostics!: Table<SyncDiagnosticRow, number>;

  constructor() {
    super("menote-local");
    this.version(1).stores({
      topics: "id, userId, parentId, [userId+deletedAt]",
      items: "id, userId, topicId, groupId, [userId+type], [userId+deletedAt], updatedAt",
      settings: "[userId+key], userId",
      outbox: "++seq, entityId, nextRetryAt",
      wraps: "itemId",
      versions: "++id, itemId, createdAt, userId",
      meta: "key",
    });
    this.version(2).stores({
      topics: "id, userId, parentId, [userId+deletedAt]",
      items: "id, userId, topicId, groupId, [userId+type], [userId+deletedAt], updatedAt",
      memoComments: "id, userId, memoId, [userId+memoId+createdAt], [userId+deletedAt]",
      settings: "[userId+key], userId",
      outbox: "++seq, entityId, nextRetryAt",
      wraps: "itemId",
      versions: "++id, itemId, createdAt, userId",
      meta: "key",
    });
    this.version(3).stores({
      topics: "id, userId, parentId, [userId+deletedAt]",
      items: "id, userId, topicId, groupId, [userId+type], [userId+deletedAt], updatedAt",
      memoComments: "id, userId, memoId, [userId+memoId+createdAt], [userId+deletedAt]",
      settings: "[userId+key], userId",
      outbox: "++seq, userId, entityId, nextRetryAt",
      wraps: "itemId",
      versions: "++id, itemId, createdAt, userId",
      meta: "key",
    }).upgrade((transaction) => transaction.table("outbox").toCollection().modify((row: OutboxRow) => {
      const payload = row.payload as { item?: Item; topic?: TopicNode; comment?: MemoComment; setting?: UserSetting } | null;
      row.userId = payload?.item?.userId ?? payload?.topic?.userId ?? payload?.comment?.userId ?? payload?.setting?.userId ?? "";
    }));
    this.version(4).stores({
      topics: "id, userId, parentId, [userId+deletedAt]",
      items: "id, userId, topicId, groupId, [userId+type], [userId+deletedAt], updatedAt",
      memoComments: "id, userId, memoId, [userId+memoId+createdAt], [userId+deletedAt]",
      settings: "[userId+key], userId",
      outbox: "++seq, userId, entityId, nextRetryAt",
      wraps: "itemId",
      topicWraps: "topicId",
      versions: "++id, itemId, createdAt, userId",
      meta: "key",
    });
    this.version(5).stores({
      topics: "id, userId, parentId, [userId+deletedAt]",
      items: "id, userId, topicId, groupId, [userId+type], [userId+deletedAt], updatedAt",
      memoComments: "id, userId, memoId, [userId+memoId+createdAt], [userId+deletedAt]",
      settings: "[userId+key], userId",
      outbox: "++seq, userId, entityId, nextRetryAt",
      wraps: "itemId",
      topicWraps: "topicId",
      versions: "++id, itemId, createdAt, userId",
      meta: "key",
      syncDiagnostics: "++id, userId, at, [userId+at]",
    });
  }
}

export const localDb = new MenoteLocalDb();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await localDb.meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await localDb.meta.put({ key, value });
}
