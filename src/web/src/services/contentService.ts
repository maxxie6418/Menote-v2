import type { Item, TopicNode } from "@menote/shared";
import { localDb, type OutboxRow } from "../db/localDb";
import { toOutboxRow } from "../db/outboxRepo";
import { listItemsInSubtree, listMemos, listTrashedItems, listUnfiled, getItem } from "../db/itemsRepo";
import { getTopic, listSubtreeIds, listTopics } from "../db/topicsRepo";
import { newId, sha256Hex } from "../lib/hash";
import { notifyLocalChange } from "../lib/broadcast";

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

/** 写命令串行队列：正文自动保存、标题防抖与属性区预览态编辑走同一链路（FR-PROP-3），
 *  读-改-写按序执行，避免并发相互覆盖（FR-PROP-3 的「统一文档更新链路」）。 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = writeChain.then(write, write);
  writeChain = next.catch(() => {});
  return next;
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
  notifyLocalChange();
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
const BLANK_SWEEP_MAX_AGE_MS = 24 * 3_600_000;

/** 正文无可见字符且标题未改的种子；Memo 不适用（随手记录本就短小）。 */
export function isBlankDraft(item: Item): boolean {
  if (item.type === "memo" || item.deletedAt !== null) return false;
  if (item.title !== BLANK_TITLE) return false;
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

/* ---------- 单篇加密（G7，G4 设计；三凭据分离：登录密码不参与任何 KEK） ---------- */

import { encryptMarkdown, generateContentKey, generateRecoveryCode, wrapContentKey } from "./cryptoService";
import { getContentKey } from "./keyring";

function packEnvelope(iv: string, ciphertext: string): string {
  return `${iv}:${ciphertext}`;
}

function unpackEnvelope(sealed: string): { iv: string; ciphertext: string } {
  const [iv, ...rest] = sealed.split(":");
  if (!iv || rest.length === 0) throw new Error("corrupt_envelope");
  return { iv, ciphertext: rest.join(":") };
}

/** 启用单篇加密：生成内容密钥、密码+恢复码双包装（FR-ENC-2/6），写回密文并随操作携带包装块。
 *  未提供恢复码时自动生成并返回（明文仅此一次展示，永不入库）。 */
export async function enableItemEncryption(
  userId: string, id: string, markdown: string, password: string, recoveryCode?: string,
): Promise<{ item: Item; recoveryCode: string; key: Uint8Array }> {
  const current = await requireItem(userId, id);
  if (current.type === "memo") throw new Error("memo_cannot_encrypt"); // FR-ENC-1：Memo 不入加密作用域
  const key = generateContentKey();
  const code = recoveryCode ?? generateRecoveryCode();
  const wraps = [
    await wrapContentKey(key, password, "password"),
    await wrapContentKey(key, code, "recovery"),
  ];
  const envelope = await encryptMarkdown(markdown, key);
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
    updatedAt: Date.now(), content: { scope: "self", ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, async () => {
    await localDb.items.put(next);
    await localDb.wraps.put({ itemId: id, wraps });
    await localDb.outbox.add({ ...outboxUpsert(next, current.rev, current.metaRev), wraps });
  });
  notifyLocalChange();
  return { item: next, recoveryCode: code, key };
}

/** 解锁态保存加密正文：以会话密钥重加密（密钥不落盘；包装块不变）。 */
export function saveEncryptedContent(userId: string, id: string, markdown: string): Promise<Item> {
  return enqueueWrite(async () => {
    const current = await requireItem(userId, id);
    if (current.type === "memo") throw new Error("memo_cannot_encrypt");
    const key = getContentKey(id);
    if (!key) throw new Error("locked");
    if (current.content.scope !== "self" && current.content.scope !== "private_space") {
      throw new Error("not_encrypted");
    }
    const envelope = await encryptMarkdown(markdown, key);
    if (markdown !== (await readPlainInner(current))) await archiveVersionBeforeSave(userId, current, "autosave");
    const next: Item = {
      ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
      updatedAt: Date.now(), content: { scope: current.content.scope, ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) },
    };
    await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
      await localDb.items.put(next);
      await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
    });
    notifyLocalChange();
    return next;
  });
}

async function readPlainInner(item: Item): Promise<string> {
  return item.content.scope === "plain" ? item.content.markdown : "";
}

/** 解密为明文形态（移除单篇加密）：包装块本地清除，服务端旧行随清理期滚动（无害残留）。 */
export async function decryptToPlain(userId: string, id: string, markdown: string): Promise<Item> {
  const current = await requireItem(userId, id);
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: await sha256Hex(markdown),
    updatedAt: Date.now(), content: { scope: "plain", markdown },
  };
  await localDb.transaction("rw", localDb.items, localDb.outbox, localDb.wraps, async () => {
    await localDb.items.put(next);
    await localDb.wraps.delete(id);
    await localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev, next.contentHash));
  });
  notifyLocalChange();
  return next;
}

/** 供 UI 预填加密信封解析。 */
export function parseEnvelope(sealed: string): { iv: string; ciphertext: string } {
  return unpackEnvelope(sealed);
}

export const encryptionHelpers = { generateRecoveryCode };

/* ---------- 版本历史与回收站（G8，FR-VER-1~7） ---------- */

import { localDb as _localDb, type VersionRow } from "../db/localDb";
export type { VersionRow };
const VERSION_KEEP_PER_ITEM = 50;
const VERSION_KEEP_PER_USER = 2000;
const VERSION_MIN_INTERVAL_MS = 10 * 60_000;

/** 封存当前稿（写入前调用）。节流：同条目 10 分钟内不重复封存（autosave 空闲语义的简化实现）。
 *  加密条目只存信封字符串（FR-VER-5；M1 schema 明文/密文互斥同构）。 */
export async function archiveVersionBeforeSave(userId: string, item: Item, reason: VersionRowReason = "autosave"): Promise<void> {
  if (item.type === "memo" && item.content.scope === "plain" && item.content.markdown === "") return;
  const last = await _localDb.versions.where("itemId").equals(item.id).last();
  if (last && Date.now() - last.createdAt < VERSION_MIN_INTERVAL_MS) return;
  const sealed = item.content.scope !== "plain";
  await _localDb.versions.add({
    itemId: item.id, userId, title: item.title ?? "",
    content: item.content.scope === "plain" ? item.content.markdown : item.content.ciphertext,
    scope: sealed ? "sealed" : "plain", rev: item.rev, reason, createdAt: Date.now(),
  });
  await trimVersions(userId, item.id);
}

export type VersionRowReason = "autosave" | "session" | "restore" | "manual";

async function trimVersions(userId: string, itemId: string): Promise<void> {
  const mine = await _localDb.versions.where("itemId").equals(itemId).toArray();
  if (mine.length > VERSION_KEEP_PER_ITEM) {
    const outdated = mine.sort((a, b) => a.createdAt - b.createdAt).slice(0, mine.length - VERSION_KEEP_PER_ITEM);
    await _localDb.versions.bulkDelete(outdated.map((row) => row.id!).filter(Boolean));
  }
  const all = await _localDb.versions.where("userId").equals(userId).toArray();
  if (all.length > VERSION_KEEP_PER_USER) {
    const outdated = all.sort((a, b) => a.createdAt - b.createdAt).slice(0, all.length - VERSION_KEEP_PER_USER);
    await _localDb.versions.bulkDelete(outdated.map((row) => row.id!).filter(Boolean));
  }
}

export async function listVersions(itemId: string) {
  const rows = await _localDb.versions.where("itemId").equals(itemId).toArray();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** 恢复版本（FR-VER-1）：先封存当前稿，再以历史内容走统一保存链路。 */
export async function restoreVersion(userId: string, itemId: string, versionId: number): Promise<Item> {
  const current = await requireItem(userId, itemId);
  const version = await _localDb.versions.get(versionId);
  if (!version || version.itemId !== itemId) throw new Error("version_not_found");
  await _localDb.versions.add({
    itemId, userId, title: current.title ?? "", content: current.content.scope === "plain" ? current.content.markdown : current.content.ciphertext,
    scope: current.content.scope === "plain" ? "plain" : "sealed", rev: current.rev, reason: "restore", createdAt: Date.now(),
  });
  if (version.scope === "plain") {
    if (current.content.scope !== "plain") throw new Error("scope_mismatch");
    return saveItemContent(userId, itemId, version.content);
  }
  // 加密条目恢复：以会话密钥重加密历史密文（解封验签失败 = 包装已失效，如实抛出）。
  if (current.content.scope === "plain" || current.type === "memo") throw new Error("scope_mismatch");
  const key = getContentKey(itemId);
  if (!key) throw new Error("locked");
  const envelope = await encryptMarkdown(version.content, key);
  const scope = current.content.scope;
  const next: Item = {
    ...current, rev: current.rev + 1, contentHash: "enc-" + envelope.ciphertext.slice(0, 16),
    updatedAt: Date.now(), content: { scope, ciphertext: packEnvelope(envelope.iv, envelope.ciphertext) },
  };
  await _localDb.transaction("rw", _localDb.items, _localDb.outbox, async () => {
    await _localDb.items.put(next);
    await _localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
  });
  notifyLocalChange();
  return next;
}

/** 回收站恢复（FR-VER-6）：清除墓碑并以 upsert 传播。 */
export async function restoreFromTrash(userId: string, id: string): Promise<void> {
  const current = await requireItem(userId, id);
  if (current.deletedAt === null) return;
  const next: Item = { ...current, deletedAt: null };
  await _localDb.transaction("rw", _localDb.items, _localDb.outbox, async () => {
    await _localDb.items.put(next);
    await _localDb.outbox.add(outboxUpsert(next, current.rev, current.metaRev));
  });
  notifyLocalChange();
}

/** 永久删除：本地行+包装块+版本一并清除；服务端硬删除走专用端点（墓碑已在软删时传播）。 */
export async function purgeItemsPermanently(userId: string, ids: string[]): Promise<void> {
  await _localDb.transaction("rw", _localDb.items, _localDb.outbox, _localDb.wraps, _localDb.versions, async () => {
    for (const id of ids) {
      await _localDb.items.delete(id);
      await _localDb.wraps.delete(id);
      const versions = await _localDb.versions.where("itemId").equals(id).toArray();
      await _localDb.versions.bulkDelete(versions.map((row) => row.id!).filter(Boolean));
    }
  });
  await fetch("/api/trash/purge", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }), cache: "no-store",
  }).catch(() => {});
  notifyLocalChange();
}
