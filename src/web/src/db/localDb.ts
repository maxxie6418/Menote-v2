import Dexie, { type Table } from "dexie";
import type { Item, TopicNode, UserSetting } from "@menote/shared";
import type { SyncEntity } from "@menote/shared";

/** 本地运行时权威副本（主文档 6.1：IndexedDB 权威 + D1 同步权威）。
 *  字段与 shared 契约单源对齐；加密条目本地同样只存密文（FR-ENC-5）。 */

export interface OutboxRow {
  seq?: number;
  operationId: string;
  entityId: string;
  entity: SyncEntity;
  action: "upsert" | "delete";
  baseRev: number;
  baseMetaRev: number;
  contentHash?: string;
  attachmentRefs?: string[];
  payload: unknown;
  queuedAt: number;
  retries: number;
  nextRetryAt: number | null;
  lastError: string | null;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/** E1 表集；版本历史（G8）与同步游标推进（G6）随对应工作项扩展。 */
class MenoteLocalDb extends Dexie {
  topics!: Table<TopicNode, string>;
  items!: Table<Item, string>;
  settings!: Table<UserSetting, [string, string]>;
  outbox!: Table<OutboxRow, number>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("menote-local");
    this.version(1).stores({
      topics: "id, userId, parentId, [userId+deletedAt]",
      items: "id, userId, topicId, groupId, [userId+type], [userId+deletedAt], updatedAt",
      settings: "[userId+key], userId",
      outbox: "++seq, entityId, nextRetryAt",
      meta: "key",
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
