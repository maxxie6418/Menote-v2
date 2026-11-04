import type { Item, KeyWrap, TopicNode } from "@menote/shared";
import { localDb } from "../db/localDb";
import { getTopic, listTopics } from "../db/topicsRepo";
import { notifyLocalChange } from "../lib/broadcast";
import { newId, sha256Hex } from "../lib/hash";
import { encryptMarkdown, generateContentKey, unwrapContentKey, wrapContentKey, wrapKeyWithRaw } from "./cryptoService";
import { createNote } from "./contentService";
import { outboxTopic, outboxUpsert } from "./contentShared";
import { recordSyncDiagnostic } from "./syncDiagnosticsService";
import {
  getTopicKey, isTopicUnlocked, lockTopic, rememberSpaceNote, setSessionKey, setTopicKey, unlockTopic,
} from "./keyringService";

/** 私人空间（FR-ENC-1/2/6）：唯一 isEncSpace 主题；K_topic 由空间密码与恢复码双包装。 */

export const PRIVATE_SPACE_NAME = "私人空间";
/** 空间密码只做日常隔离，不追求高强度口令（负责人 2026-11-03）。登录口令与单篇密码不沿用此下限。 */
export const PRIVATE_SPACE_PASSWORD_MIN = 4;

export async function findPrivateSpace(userId: string): Promise<TopicNode | undefined> {
  const topics = await listTopics(userId);
  return topics.find((row) => row.isEncSpace && row.deletedAt === null && row.depth === 0);
}

export async function privateRootOf(userId: string, topicId: string): Promise<TopicNode | undefined> {
  const topic = await getTopic(userId, topicId);
  if (!topic || topic.deletedAt !== null) return undefined;
  if (topic.isEncSpace) return topic;
  if (!topic.parentId) return undefined;
  const parent = await getTopic(userId, topic.parentId);
  return parent?.isEncSpace && parent.deletedAt === null ? parent : undefined;
}

export async function privateSpaceReady(topicId: string): Promise<boolean> {
  const row = await localDb.topicWraps.get(topicId);
  return Boolean(row?.wraps.some((wrap) => wrap.wrapper === "password"));
}

/** 账户里是否已经有恢复码包装（单篇或私人空间）。有则不得再发一枚新码。 */
export async function recoveryWrapExists(): Promise<boolean> {
  const items = await localDb.wraps.toArray();
  if (items.some((row) => row.wraps.some((wrap) => wrap.wrapper === "recovery"))) return true;
  const topics = await localDb.topicWraps.toArray();
  return topics.some((row) => row.wraps.some((wrap) => wrap.wrapper === "recovery"));
}

/** 用既有恢复码包装验证用户输入。成功只说明码正确，不把解开的密钥留下。 */
export async function verifyRecoveryCode(code: string): Promise<boolean> {
  const candidates: KeyWrap[] = [];
  for (const row of await localDb.wraps.toArray()) {
    const wrap = row.wraps.find((entry) => entry.wrapper === "recovery");
    if (wrap) candidates.push(wrap);
  }
  for (const row of await localDb.topicWraps.toArray()) {
    const wrap = row.wraps.find((entry) => entry.wrapper === "recovery");
    if (wrap) candidates.push(wrap);
  }
  for (const wrap of candidates) {
    try {
      await unwrapContentKey(wrap, code);
      return true;
    } catch { /* 下一份包装。 */ }
  }
  return false;
}

export async function setupPrivateSpace(userId: string, password: string, recoveryCode: string): Promise<TopicNode> {
  if (password.length < PRIVATE_SPACE_PASSWORD_MIN) throw new Error(`密码至少 ${PRIVATE_SPACE_PASSWORD_MIN} 位`);
  const existing = await findPrivateSpace(userId);
  if (existing && await privateSpaceReady(existing.id)) throw new Error("私人空间已设置");
  if (await recoveryWrapExists()) {
    const matches = await verifyRecoveryCode(recoveryCode);
    if (!matches) throw new Error("恢复码不正确");
  }
  const topic: TopicNode = existing ?? {
    id: newId(), userId, parentId: null, name: PRIVATE_SPACE_NAME, depth: 0, isEncSpace: true, deletedAt: null,
  };
  const key = generateContentKey();
  const wraps = [
    await wrapContentKey(key, password, "password"),
    await wrapContentKey(key, recoveryCode, "recovery"),
  ];
  await localDb.transaction("rw", localDb.topics, localDb.topicWraps, localDb.outbox, async () => {
    await localDb.topics.put(topic);
    await localDb.topicWraps.put({ topicId: topic.id, wraps });
    await localDb.outbox.add({ ...outboxTopic(topic, "upsert"), wraps });
  });
  setTopicKey(topic.id, key);
  notifyLocalChange();
  return topic;
}

export async function unlockPrivateSpace(userId: string, credential: string, useRecovery: boolean): Promise<"ok" | "bad_credential" | "no_wraps" | "missing"> {
  const topic = await findPrivateSpace(userId);
  if (!topic) return "missing";
  return unlockTopic(topic.id, credential, useRecovery);
}

export async function lockPrivateSpace(userId: string): Promise<void> {
  const topic = await findPrivateSpace(userId);
  if (topic) lockTopic(topic.id);
}

/** 锁定中的私人空间及其分组。已解锁的不隐藏。 */
export function hiddenPrivateTopicIds(topics: TopicNode[]): Set<string> {
  const ids = new Set(
    topics.filter((topic) => topic.isEncSpace && topic.deletedAt === null && !isTopicUnlocked(topic.id)).map((topic) => topic.id),
  );
  for (const topic of topics) {
    if (topic.parentId && ids.has(topic.parentId)) ids.add(topic.id);
  }
  return ids;
}

export function isHiddenPrivateItem(item: Item, topics: TopicNode[]): boolean {
  return item.topicId !== null && hiddenPrivateTopicIds(topics).has(item.topicId);
}

async function nextUntitledTitle(userId: string): Promise<string> {
  const items = await localDb.items.where("userId").equals(userId).toArray();
  const existing = new Set(items.filter((item) => item.type !== "memo").map((item) => item.title).filter((title): title is string => title !== null));
  if (!existing.has("无标题")) return "无标题";
  let suffix = 2;
  while (existing.has(`无标题 ${suffix}`)) suffix += 1;
  return `无标题 ${suffix}`;
}

/** 在已解锁的私人空间（或其分组）里新建笔记。K_item 由 K_topic 包装。 */
export async function createPrivateNote(userId: string, placeId: string): Promise<Item> {
  const root = await privateRootOf(userId, placeId);
  if (!root) throw new Error("not_private_space");
  const topicKey = getTopicKey(root.id);
  if (!topicKey) throw new Error("private_space_locked");
  const place = await getTopic(userId, placeId);
  const inGroup = place?.depth === 1;
  const key = generateContentKey();
  const envelope = await encryptMarkdown("", key);
  const wraps = [await wrapKeyWithRaw(key, topicKey)];
  const sealed = `${envelope.iv}:${envelope.ciphertext}`;
  const contentHash = `enc-${(await sha256Hex(sealed)).slice(0, 16)}`;
  const now = Date.now();
  const draft: Item = {
    id: newId(), userId, type: "note",
    topicId: placeId, groupId: inGroup ? placeId : null,
    title: "无标题", tags: [], status: null, attachmentHashes: [],
    source: "manual", rev: 1, metaRev: 1, contentHash,
    pinned: false, starred: false, createdAt: now, updatedAt: now, deletedAt: null,
    content: { scope: "private_space", ciphertext: sealed },
  };
  let created = draft;
  await localDb.transaction("rw", localDb.items, localDb.wraps, localDb.outbox, async () => {
    created = { ...draft, title: await nextUntitledTitle(userId) };
    await localDb.items.put(created);
    await localDb.wraps.put({ itemId: created.id, wraps });
    await localDb.outbox.add({ ...outboxUpsert(created, 0, 0, contentHash), wraps });
  });
  recordSyncDiagnostic(userId, {
    category: "local", event: "note_created_locally", entity: "item", entityId: created.id,
    action: "upsert", baseRev: 0, baseMetaRev: 0,
  });
  setSessionKey(created.id, key);
  rememberSpaceNote(created.id, root.id);
  notifyLocalChange();
  return created;
}

/** 当前若在已解锁的私人空间里，新建笔记直接进该空间；否则仍进草稿箱。 */
export async function createNoteForPlace(
  userId: string,
  placeId: string | null,
): Promise<{ item: Item; section: { kind: "drafts" } | { kind: "topic"; id: string } }> {
  if (placeId) {
    const place = await getTopic(userId, placeId);
    if (!place || place.deletedAt !== null) throw new Error("笔记存放位置不可用");
    const rootId = place.depth === 0 ? place.id : place.parentId;
    const root = rootId ? await privateRootOf(userId, rootId) : undefined;
    if (root) {
      if (!getTopicKey(root.id)) throw new Error("private_space_locked");
      return { item: await createPrivateNote(userId, placeId), section: { kind: "topic", id: placeId } };
    }
    const topicId = place.depth === 0 ? place.id : place.parentId;
    const groupId = place.depth === 1 ? place.id : null;
    if (!topicId) throw new Error("分组缺少所属主题");
    return { item: await createNote(userId, { topicId, groupId }), section: { kind: "topic", id: placeId } };
  }
  return { item: await createNote(userId), section: { kind: "drafts" } };
}
