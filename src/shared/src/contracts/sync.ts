import type { Item } from "../types/item";
import type { TopicNode } from "../types/identity";
import type { UserSetting } from "../types/settings";

/** G2 定稿：游标 = 服务端 sync_log.seq（单库单调）；冲突/幂等语义见管理线计划「专项设计」。 */

export interface SyncTombstone {
  id: string;
  userId: string;
  entity: "item" | "topic";
  deletedAt: number;
}

export interface SyncPage {
  items: Item[];
  topics: TopicNode[];
  tombstones: SyncTombstone[];
  settings: UserSetting[];
  nextCursor: string | null;
  hasMore: boolean;
  fullResync: boolean;
}

export type SyncEntity = "item" | "topic" | "setting";

/** 客户端单次写操作；正文操作必带 contentHash 与 attachmentRefs（缺省 = 不动引用表）。 */
export interface OutboxOperation {
  operationId: string;
  userId: string;
  entityId: string;
  entity: SyncEntity;
  action: "upsert" | "delete";
  baseRev: number;
  baseMetaRev: number;
  contentHash?: string;
  attachmentRefs?: string[];
  payload: unknown;
}

export interface SyncPushRequest {
  deviceId: string;
  /** 单请求 ≤ 10 操作；操作间独立事务，部分冲突不回滚其余操作。 */
  operations: OutboxOperation[];
}

/** 服务端当前值，供重放判定与冲突副本命名。 */
export interface SyncConflictDetail {
  rev: number;
  metaRev: number;
  contentHash: string | null;
}

export type SyncOperationResult =
  | { operationId: string; result: "applied"; rev: number; metaRev: number }
  | { operationId: string; result: "duplicate"; rev: number; metaRev: number; contentHash: string | null }
  | { operationId: string; result: "conflict"; detail: SyncConflictDetail };

export interface SyncPushResponse {
  results: SyncOperationResult[];
}
