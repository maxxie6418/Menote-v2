import type { Item, KeyWrap } from "@menote/shared";
import { localDb } from "../db/localDb";
import { decryptMarkdown, unwrapContentKey, unwrapKeyWithRaw } from "./cryptoService";

/**
 * 会话密钥环与锁定策略（G7，G4 设计 §5）：
 * - 解锁态明文工作副本仅在内存；锁定/超时全部丢弃；本地库只存密文与包装块。
 * - 新会话默认锁定 + 不活动超时自动锁定（默认 15 分钟）+ 随时手动锁（FR-ENC-4）。
 * - 密钥材料不进入 stores（C-7/工程设计 §3-4）。
 */

const noteKeys = new Map<string, Uint8Array>();
const topicKeys = new Map<string, Uint8Array>();
/** 由私人空间打开的笔记：离开单篇不锁，锁定空间时一并丢弃。 */
const spaceNotes = new Map<string, string>();
let lastActivity = Date.now();
export const LOCK_TIMEOUT_MS = 15 * 60_000;

const listeners = new Set<() => void>();
const beforeLock = new Set<() => Promise<void>>();
let version = 0;
function bump(): void {
  version += 1;
  lastActivity = Date.now();
  listeners.forEach((listener) => listener());
}

export function subscribeLockState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getLockVersion(): number {
  return version;
}

export function isNoteUnlocked(itemId: string): boolean {
  return noteKeys.has(itemId);
}

export function isTopicUnlocked(topicId: string): boolean {
  return topicKeys.has(topicId);
}

export function getTopicKey(topicId: string): Uint8Array | null {
  return topicKeys.get(topicId) ?? null;
}

export function touchActivity(): void {
  lastActivity = Date.now();
}

/** 锁定前先落盘。调用方必须在密钥仍在内存时把未保存明文写完。 */
export function registerBeforeLock(flush: () => Promise<void>): () => void {
  beforeLock.add(flush);
  return () => beforeLock.delete(flush);
}

async function flushBeforeLock(): Promise<void> {
  await Promise.all([...beforeLock].map((flush) => flush().catch(() => undefined)));
}

export async function lockItem(itemId: string): Promise<void> {
  await flushBeforeLock();
  noteKeys.delete(itemId);
  spaceNotes.delete(itemId);
  bump();
}

/** 锁定私人空间，并丢弃由它打开的笔记密钥。 */
export async function lockTopic(topicId: string): Promise<void> {
  await flushBeforeLock();
  topicKeys.delete(topicId);
  for (const [itemId, owner] of spaceNotes) {
    if (owner !== topicId) continue;
    noteKeys.delete(itemId);
    spaceNotes.delete(itemId);
  }
  bump();
}

/** 不活动超时（FR-ENC-4）：丢弃全部会话密钥。由调度器定期调用检查。 */
export async function lockIfIdle(now = Date.now()): Promise<boolean> {
  if ((noteKeys.size > 0 || topicKeys.size > 0) && now - lastActivity > LOCK_TIMEOUT_MS) {
    await flushBeforeLock();
    noteKeys.clear();
    topicKeys.clear();
    spaceNotes.clear();
    bump();
    return true;
  }
  return false;
}

export function hasLockedNotes(items: Item[]): boolean {
  return items.some((item) => item.content.scope !== "plain" && !noteKeys.has(item.id));
}

/** 解锁单篇：优先 password 包装，失败回退 recovery 包装（FR-ENC-6 凭码解锁）。 */
export async function unlockNote(itemId: string, credential: string, useRecovery = false): Promise<"ok" | "bad_credential" | "no_wraps"> {
  const row = await localDb.wraps.get(itemId);
  if (!row || row.wraps.length === 0) return "no_wraps";
  const order: KeyWrap["wrapper"][] = useRecovery ? ["recovery", "password"] : ["password", "recovery"];
  for (const wrapper of order) {
    const wrap = row.wraps.find((entry) => entry.wrapper === wrapper);
    if (!wrap) continue;
    try {
      const key = await unwrapContentKey(wrap, credential);
      noteKeys.set(itemId, key);
      bump();
      return "ok";
    } catch { /* 试下一个包装块。 */ }
  }
  return "bad_credential";
}

/** 解锁态读取明文（未解锁返回 null；调用方展示锁定态）。 */
export async function readPlain(itemId: string, envelope: { iv: string; ciphertext: string }): Promise<string | null> {
  const key = noteKeys.get(itemId);
  if (!key) return null;
  try {
    return await decryptMarkdown(envelope, key);
  } catch {
    return null;
  }
}

export function getContentKey(itemId: string): Uint8Array | null {
  return noteKeys.get(itemId) ?? null;
}

export function setSessionKey(itemId: string, key: Uint8Array): void {
  noteKeys.set(itemId, key);
  bump();
}

export function setTopicKey(topicId: string, key: Uint8Array): void {
  topicKeys.set(topicId, key);
  bump();
}

/** 记下这篇笔记属于已解锁的私人空间，离开时不单独上锁。 */
export function rememberSpaceNote(itemId: string, topicId: string): void {
  spaceNotes.set(itemId, topicId);
}

async function resolveEncRootId(topicId: string): Promise<string | null> {
  const topic = await localDb.topics.get(topicId);
  if (!topic || topic.deletedAt !== null) return null;
  if (topic.isEncSpace) return topic.id;
  if (!topic.parentId) return null;
  const parent = await localDb.topics.get(topic.parentId);
  return parent?.isEncSpace && parent.deletedAt === null ? parent.id : null;
}

/** 用已解锁的 K_topic 打开空间内笔记。分组笔记回溯到父级私人空间。 */
export async function openSpaceNote(itemId: string, topicId: string | null): Promise<"ok" | "locked" | "no_wrap"> {
  if (!topicId) return "locked";
  const rootId = await resolveEncRootId(topicId);
  if (!rootId) return "locked";
  const topicKey = topicKeys.get(rootId);
  if (!topicKey) return "locked";
  const row = await localDb.wraps.get(itemId);
  const wrap = row?.wraps.find((entry) => entry.wrapper === "topic");
  if (!wrap) return "no_wrap";
  try {
    const key = await unwrapKeyWithRaw(wrap, topicKey);
    noteKeys.set(itemId, key);
    spaceNotes.set(itemId, rootId);
    bump();
    return "ok";
  } catch {
    return "no_wrap";
  }
}

/** 解锁私人空间主题密钥。只认空间密码或恢复码，不认笔记包装。 */
export async function unlockTopic(topicId: string, credential: string, useRecovery = false): Promise<"ok" | "bad_credential" | "no_wraps"> {
  const row = await localDb.topicWraps.get(topicId);
  if (!row || row.wraps.length === 0) return "no_wraps";
  const order: KeyWrap["wrapper"][] = useRecovery ? ["recovery", "password"] : ["password", "recovery"];
  for (const wrapper of order) {
    const wrap = row.wraps.find((entry) => entry.wrapper === wrapper);
    if (!wrap || wrap.wrapper === "topic") continue;
    try {
      const key = await unwrapContentKey(wrap, credential);
      topicKeys.set(topicId, key);
      bump();
      return "ok";
    } catch { /* 试下一个包装块。 */ }
  }
  return "bad_credential";
}

/** 单篇离开即重锁（FR-ENC-4）。私人空间笔记除外：空间仍开着时离开不锁。 */
export function lockOnLeave(itemId: string): void {
  if (spaceNotes.has(itemId)) return;
  if (noteKeys.has(itemId)) lockItem(itemId);
}
