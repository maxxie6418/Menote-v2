import type { Item } from "../types/item";
import type { TopicNode } from "../types/identity";
import type { UserSetting } from "../types/settings";

/** Initial shape only; cursor lifecycle and conflict protocol require M2 design. */
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

/** Operation identity supports deduplication; conflict details are not finalized. */
export interface OutboxOperation {
  operationId: string;
  userId: string;
  entityId: string;
  entity: "item" | "topic" | "setting";
  action: "upsert" | "delete";
  payload: unknown;
}
