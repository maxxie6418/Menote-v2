import type { Item, MemoComment } from "../types/item";
import type { TopicNode } from "../types/identity";
import type { UserSetting } from "../types/settings";

/** G2 定稿：游标 = 服务端 sync_log.seq（单库单调）；冲突/幂等语义见管理线计划「专项设计」。
 *  G7 补充：加密条目的密钥包装块随 upsert 同步（payload.wraps / SyncPage.wraps），否则他端无法解锁。 */

/** 密钥包装块（G4 设计 §2；b64 编码传输）。 */
export interface KeyWrap {
  wrapper: "password" | "recovery" | "topic";
  kdfSalt: string;
  kdfIterations: number;
  iv: string;
  ciphertext: string;
  generation: number;
}

export interface SyncTombstone {
  id: string;
  userId: string;
  entity: "item" | "topic" | "memo_comment";
  deletedAt: number;
}

export interface SyncPage {
  items: Item[];
  memoComments: MemoComment[];
  topics: TopicNode[];
  tombstones: SyncTombstone[];
  settings: UserSetting[];
  /** 加密条目的包装块（按条目分组随页返回，G7）。 */
  wraps: Array<{ itemId: string; wraps: KeyWrap[] }>;
  nextCursor: string | null;
  hasMore: boolean;
  fullResync: boolean;
}

export type SyncEntity = "item" | "topic" | "setting" | "memo_comment";

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
  /** 加密条目：随载荷携带密码/恢复码/主题包装块（G7）。 */
  wraps?: KeyWrap[];
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
  | { operationId: string; result: "conflict"; detail: SyncConflictDetail }
  /** 不可重试拒绝（载荷非法/实体缺失）；客户端移入失败列表，不入重试。 */
  | { operationId: string; result: "rejected"; code: string };

export interface SyncPushResponse {
  results: SyncOperationResult[];
}
