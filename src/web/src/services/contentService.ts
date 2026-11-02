import type { Item, TopicNode } from "@menote/shared";
import { localDb } from "../db/localDb";
import { notifyLocalChange } from "../lib/broadcast";
import { newId, sha256Hex } from "../lib/hash";
import { enqueueWrite, outboxTopic, outboxUpsert, requireItem } from "./contentShared";
import { archiveVersionBeforeSave } from "./versionService";
import { FIELDS_KEY, splitFrontmatter, writeDef } from "../lib/frontmatter";
import { findTables, renderTable } from "../lib/gfmTable";
import { listItemsInSubtree, listMemos, listTrashedItems, listUnfiled, getItem } from "../db/itemsRepo";
import { getTopic, listSubtreeIds, listTopics } from "../db/topicsRepo";
import { toOutboxRow } from "../db/outboxRepo";

/**
 * 内容统一命令链路（E1 骨架，G10 整理拆分）：读一律以本地库为源；写 = 本地变更 + outbox 入队
 * 同一 Dexie 事务。加密命令见 encryptionCommandService，版本/回收站见 versionService，
 * 共享底座（写队列/载荷/信封）见 contentShared。
 */

const ITEM_SOURCE = { manual: "manual", external: "external" } as const;
export type ItemSource = (typeof ITEM_SOURCE)[keyof typeof ITEM_SOURCE];

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
  notifyLocalChange();
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
  notifyLocalChange();
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
  notifyLocalChange();
}

/* ---------- Note / 表格文档 ---------- */

export async function createNote(
  userId: string,
  options: { title?: string; type?: "note" | "table"; topicId?: string | null; groupId?: string | null; source?: ItemSource } = {},
): Promise<Item> {
  const source = options.source ?? "manual";
  const requestedTitle = options.title?.trim() || "无标题";
  const item: Item = {
    id: newId(), userId, type: options.type ?? "note",
    topicId: options.topicId ?? null, groupId: options.groupId ?? null,
    title: requestedTitle, tags: [], status: null, attachmentHashes: [],
    source, rev: 1, metaRev: 1, contentHash: await sha256Hex(""),
    pinned: false, starred: false, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
    content: { scope: "plain", markdown: "" },
  };
  let createdItem = item;
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    const title = source === "manual" && requestedTitle === "无标题"
      ? await nextUntitledTitle(userId)
      : requestedTitle;
    createdItem = { ...item, title };
    await localDb.items.put(createdItem);
    await localDb.outbox.add(outboxUpsert(createdItem, 0, 0, createdItem.contentHash));
  });
  notifyLocalChange();
  return createdItem;
}

/** 手动新建默认标题按用户现有条目编号，避免连续创建出相同的“无标题”。 */
async function nextUntitledTitle(userId: string): Promise<string> {
  const items = await localDb.items.where("userId").equals(userId).toArray();
  const existing = new Set(items.filter((item) => item.type !== "memo").map((item) => item.title).filter((title): title is string => title !== null));
  if (!existing.has("无标题")) return "无标题";
  let suffix = 2;
  while (existing.has(`无标题 ${suffix}`)) suffix += 1;
  return `无标题 ${suffix}`;
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
  notifyLocalChange();
  return item;
}

/**
 * 形态切换（TP2 多维表格）：空白种子期 note↔table 互转；内容落下即锁定（负责人 2026-11-01 决策）。
 * 2026-11-02 补充：转入表格时落一个「名称」文本列作为种子（负责人反馈"转表格后应该直接能填"），
 * 该种子视同空白——转回笔记时清空，不占用形态锁。
 */
export function setItemForm(userId: string, id: string, to: "note" | "table"): Promise<Item> {
  return enqueueWrite(() => setItemFormInner(userId, id, to));
}

const DEFAULT_TABLE_COLUMN = "名称";

/** 空白笔记转表格的初始正文：一个「名称」文本列 + 空表体。 */
export function defaultTableSeed(): string {
  return `${writeDef("", FIELDS_KEY, DEFAULT_TABLE_COLUMN, { type: "text" })}${renderTable([DEFAULT_TABLE_COLUMN], [])}`;
}

const compact = (value: string) => value.replace(/\s+/g, "");

/** 是否仍是未动过的表格种子（只有「名称」列、没有数据行、正文只有这张表）。 */
export function isDefaultTableSeed(item: Item): boolean {
  if (item.type !== "table" || item.content.scope !== "plain") return false;
  const { body } = splitFrontmatter(item.content.markdown);
  const tables = findTables(body);
  if (tables.length !== 1) return false;
  const table = tables[0]!;
  if (table.header.length !== 1 || table.header[0]!.trim() !== DEFAULT_TABLE_COLUMN || table.rows.length > 0) return false;
  return compact(body) === compact(renderTable([DEFAULT_TABLE_COLUMN], []));
}

async function setItemFormInner(userId: string, id: string, to: "note" | "table"): Promise<Item> {
  const current = await requireItem(userId, id);
  if (current.type === "memo") throw new Error("Memo 不参与形态切换");
  if (current.type === to) return current;
  const blankNow = isConvertibleBlankDraft(current);
  const seededNow = isDefaultTableSeed(current);
  if ((!blankNow && !seededNow) || current.content.scope !== "plain") {
    throw new Error("已有内容的文档不可切换形态（FR-TBL-9）");
  }
  // 空白笔记 → 表格：落「名称」列种子；表格种子 → 笔记：清掉种子回到空白
  const seeding = to === "table" && blankNow;
  const clearing = to === "note" && seededNow;
  const markdown = seeding ? defaultTableSeed() : clearing ? "" : current.content.markdown;
  const contentChanged = markdown !== current.content.markdown;
  const contentHash = contentChanged ? await sha256Hex(markdown) : current.contentHash;
  const next: Item = {
    ...current,
    type: to,
    ...(contentChanged ? { rev: current.rev + 1, contentHash, content: { scope: "plain" as const, markdown } } : {}),
    metaRev: current.metaRev + 1,
    updatedAt: Date.now(),
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, contentChanged ? contentHash : undefined));
  });
  notifyLocalChange();
  return next;
}

/** 表格结构损坏降级（FR-VER-2，table→note 单向）：降级前先封存当前稿，版本历史可追溯。 */
export function degradeTableToNote(userId: string, id: string): Promise<Item> {
  return enqueueWrite(() => degradeTableToNoteInner(userId, id));
}

async function degradeTableToNoteInner(userId: string, id: string): Promise<Item> {
  const current = await requireItem(userId, id);
  if (current.type !== "table") throw new Error("仅表格文档可降级");
  await archiveVersionBeforeSave(userId, current, "manual");
  const next = { ...current, type: "note", metaRev: current.metaRev + 1, updatedAt: Date.now() } as Item;
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
  });
  notifyLocalChange();
  return next;
}

/** 正文保存（E2 自动保存复用）：rev+1、contentHash 重算、outbox 带 baseRev 供服务端冲突检测。 */
export function saveItemContent(userId: string, id: string, markdown: string): Promise<Item> {
  return enqueueWrite(() => saveItemContentInner(userId, id, markdown));
}

async function saveItemContentInner(userId: string, id: string, markdown: string): Promise<Item> {
  const current = await requireItem(userId, id);
  if (current.content.scope !== "plain") throw new Error("加密条目正文经加密门面保存（G7）");
  // FR-VER-2：autosave 空闲封存（写入前留一份当前稿，10 分钟节流）。
  if (markdown !== current.content.markdown) await archiveVersionBeforeSave(userId, current, "autosave");
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
  notifyLocalChange();
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

export function saveItemMeta(userId: string, id: string, patch: ItemMetaPatch): Promise<Item> {
  return enqueueWrite(() => saveItemMetaInner(userId, id, patch));
}

async function saveItemMetaInner(userId: string, id: string, patch: ItemMetaPatch): Promise<Item> {
  const current = await requireItem(userId, id);
  if (patch.groupId && !patch.topicId) throw new Error("分组归属必须同时指定主题（D1 约束同构）");
  const next: Item = {
    ...current, ...patch, metaRev: current.metaRev + 1, updatedAt: Date.now(),
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
    await localDb.items.put(next);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
  });
  notifyLocalChange();
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
  notifyLocalChange();
}

/* ---------- 空白草稿三道闸（FR-VER-7：种子从不上传，本地兜底回收） ---------- */

export const BLANK_TITLE = "无标题";
/** 默认标题（含 v1.6 递增编号「无标题 2」）均视为未改名；形态选择条与三道闸共用此判定。 */
export const BLANK_TITLE_PATTERN = /^(?:无标题)(?: \d+)?$/;
const BLANK_SWEEP_MAX_AGE_MS = 24 * 3_600_000;

/** 正文无可见字符且标题未改的种子；Memo 不适用（随手记录本就短小）。 */
export function isBlankDraft(item: Item): boolean {
  if (item.type === "memo" || item.deletedAt !== null) return false;
  if (!BLANK_TITLE_PATTERN.test(item.title)) return false;
  return isConvertibleBlankDraft(item);
}

/** 形态切换按正文是否已有内容判断；标题是元数据，改名不应锁住转换。 */
export function isConvertibleBlankDraft(item: Item): boolean {
  if (item.type === "memo" || item.deletedAt !== null) return false;
  if (item.content.scope !== "plain") return false;
  return !/\S/.test(item.content.markdown);
}

/** 启动兜底扫描（带宽限期 24h）：①非 create 状态不动（已有真实编辑）；②队列有 create 之外
 *  的待推操作不动；③仍空白才本地回收（连同其 create 操作一并移除，种子永不上传）。 */
export async function sweepBlankDrafts(userId: string, now = Date.now()): Promise<number> {
  const seeds = await localDb.items.where("userId").equals(userId)
    .filter((row) => isBlankDraft(row) && now - row.createdAt > BLANK_SWEEP_MAX_AGE_MS)
    .toArray();
  let swept = 0;
  for (const seed of seeds) {
    if (seed.rev > 1 || seed.metaRev > 1) continue;
    const pending = await localDb.outbox.where("entityId").equals(seed.id).toArray();
    const hasRealWork = pending.some((row) => {
      if (row.action !== "upsert") return true;
      const payloadItem = (row.payload as { item?: Item }).item;
      return payloadItem?.rev !== 1 || payloadItem.metaRev !== 1;
    });
    if (hasRealWork) continue;
    await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
      await localDb.items.delete(seed.id);
      await localDb.outbox.bulkDelete(pending.map((row) => row.seq!).filter((seq) => seq !== undefined));
    });
    swept += 1;
  }
  if (swept > 0) notifyLocalChange();
  return swept;
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
