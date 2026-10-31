import type { Item, TopicNode } from "@menote/shared";
import { localDb, type OutboxRow } from "../db/localDb";
import { toOutboxRow } from "../db/outboxRepo";
import { listItemsInSubtree, listMemos, listTrashedItems, listUnfiled, getItem } from "../db/itemsRepo";
import { getTopic, listSubtreeIds, listTopics } from "../db/topicsRepo";
import { newId, sha256Hex } from "../lib/hash";

/**
 * 内容统一命令链路（E1 骨架）：读一律以本地库为源；写 = 本地变更 + outbox 入队同一 Dexie 事务，
 * E2 自动保存与 G6 推送复用同一入口。加密条目在 G7 接入（命令层先持明文，本地暂为明文作用域）。
 */

const ITEM_SOURCE = { manual: "manual", external: "external" } as const;
export type ItemSource = (typeof ITEM_SOURCE)[keyof typeof ITEM_SOURCE];

function outboxUpsert(item: Item, baseRev: number, baseMetaRev: number, contentHash?: string): OutboxRow {
  return toOutboxRow({
    operationId: newId(), userId: item.userId, entityId: item.id, entity: "item",
    action: "upsert", baseRev, baseMetaRev, contentHash, payload: { item },
  }, Date.now());
}

function outboxTopic(topic: TopicNode, action: "upsert" | "delete"): OutboxRow {
  return toOutboxRow({
    operationId: newId(), userId: topic.userId, entityId: topic.id, entity: "topic",
    action, baseRev: 0, baseMetaRev: 0, payload: { topic },
  }, Date.now());
}

function requireItem(userId: string, id: string): Promise<Item> {
  return getItem(userId, id).then((item) => {
    if (!item) throw new Error(`item not found: ${id}`);
    return item;
  });
}

/* ---------- 主题与分组 ---------- */

export async function createTopic(userId: string, name: string, parentId: string | null = null): Promise<TopicNode> {
  const parent = parentId ? await getTopic(userId, parentId) : undefined;
  if (parentId && (!parent || parent.depth !== 0 || parent.deletedAt !== null)) {
    throw new Error("分组只能挂在主题下（FR-IA-1）");
  }
  const topic: TopicNode = {
    id: newId(), userId, parentId, name, depth: parent ? 1 : 0, isEncSpace: false, deletedAt: null,
  };
  await localDb.transaction("rw", localDb.topics, localDb.outbox, async () => {
    await localDb.topics.put(topic);
    await localDb.outbox.add(outboxTopic(topic, "upsert"));
  });
  return topic;
}

export async function renameTopic(userId: string, id: string, name: string): Promise<TopicNode> {
  const topic = await getTopic(userId, id);
  if (!topic) throw new Error(`topic not found: ${id}`);
  const next = { ...topic, name };
  await localDb.transaction("rw", localDb.topics, localDb.outbox, async () => {
    await localDb.topics.put(next);
    await localDb.outbox.add(outboxTopic(next, "upsert"));
  });
  return next;
}

export async function softDeleteTopic(userId: string, id: string): Promise<void> {
  const topic = await getTopic(userId, id);
  if (!topic) throw new Error(`topic not found: ${id}`);
  const next = { ...topic, deletedAt: Date.now() };
  await localDb.transaction("rw", localDb.topics, localDb.outbox, async () => {
    await localDb.topics.put(next);
    await localDb.outbox.add(outboxTopic(next, "delete"));
  });
}

/* ---------- Note / 表格文档 ---------- */

export async function createNote(
  userId: string, options: { title?: string; topicId?: string | null; groupId?: string | null; source?: ItemSource } = {},
): Promise<Item> {
  const source = options.source ?? "manual";
  const item: Item = {
    id: newId(), userId, type: "note",
    topicId: options.topicId ?? null, groupId: options.groupId ?? null,
    title: options.title?.trim() || "无标题", tags: [], status: null, attachmentHashes: [],
    source, rev: 1, metaRev: 1, contentHash: await sha256Hex(""),
    pinned: false, starred: false, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
    content: { scope: "plain", markdown: "" },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(item);
    await localDb.outbox.add(outboxUpsert(item, 0, 0, item.contentHash));
  });
  return item;
}

export async function createMemo(userId: string, markdown: string, tags: string[] = []): Promise<Item> {
  const now = Date.now();
  const item: Item = {
    id: newId(), userId, type: "memo", topicId: null, groupId: null,
    title: null, tags, status: null, attachmentHashes: [], source: "manual",
    rev: 1, metaRev: 1, contentHash: await sha256Hex(markdown),
    pinned: false, starred: false, createdAt: now, updatedAt: now, deletedAt: null,
    content: { scope: "plain", markdown },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(item);
    await localDb.outbox.add(outboxUpsert(item, 0, 0, item.contentHash));
  });
  return item;
}

/** 正文保存（E2 自动保存复用）：rev+1、contentHash 重算、outbox 带 baseRev 供服务端冲突检测。 */
export async function saveItemContent(userId: string, id: string, markdown: string): Promise<Item> {
  const current = await requireItem(userId, id);
  if (current.content.scope !== "plain") throw new Error("加密条目正文经加密门面保存（G7）");
  const contentHash = await sha256Hex(markdown);
  if (contentHash === current.contentHash && current.content.markdown === markdown) return current;
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash, updatedAt: Date.now(),
    content: { scope: "plain", markdown },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, contentHash));
  });
  return next;
}

export interface ItemMetaPatch {
  title?: string;
  tags?: string[];
  topicId?: string | null;
  groupId?: string | null;
  status?: "todo" | "doing" | "done" | null;
  pinned?: boolean;
  starred?: boolean;
}

export async function saveItemMeta(userId: string, id: string, patch: ItemMetaPatch): Promise<Item> {
  const current = await requireItem(userId, id);
  if (patch.groupId && !patch.topicId) throw new Error("分组归属必须同时指定主题（D1 约束同构）");
  const next: Item = {
    ...current, ...patch, metaRev: current.metaRev + 1, updatedAt: Date.now(),
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
  });
  return next;
}

/** 软删（回收站入口在 G8）；同步语义为 delete 墓碑，数据本体保留。 */
export async function softDeleteItem(userId: string, id: string): Promise<void> {
  const current = await requireItem(userId, id);
  const next: Item = { ...current, deletedAt: Date.now() };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(toOutboxRow({
      operationId: newId(), userId, entityId: id, entity: "item",
      action: "delete", baseRev: current.rev, baseMetaRev: current.metaRev,
      payload: { deletedAt: next.deletedAt },
    }, Date.now()));
  });
}

/* ---------- 查询（读以本地库为源） ---------- */

export const queries = {
  topics: (userId: string) => listTopics(userId),
  async notesInTopic(userId: string, topicId: string): Promise<Item[]> {
    const subtree = await listSubtreeIds(userId, topicId);
    const rows = await listItemsInSubtree(userId, subtree);
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows;
  },
  /** 收件箱 = 外部采集/Agent 未归类；草稿箱 = 手动未归类（FR-IA-2）。 */
  inbox: (userId: string) => listUnfiled(userId, "external"),
  drafts: (userId: string) => listUnfiled(userId, "manual"),
  memos: (userId: string) => listMemos(userId),
  trashed: (userId: string) => listTrashedItems(userId),
  item: getItem,
  topic: getTopic,
};
