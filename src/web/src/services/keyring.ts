import type { Item, KeyWrap } from "@menote/shared";
import { localDb } from "../db/localDb";
import { decryptMarkdown, unwrapContentKey } from "./cryptoService";

/**
 * 会话密钥环与锁定策略（G7，G4 设计 §5）：
 * - 解锁态明文工作副本仅在内存；锁定/超时全部丢弃；本地库只存密文与包装块。
 * - 新会话默认锁定 + 不活动超时自动锁定（默认 15 分钟）+ 随时手动锁（FR-ENC-4）。
 * - 密钥材料不进入 stores（C-7/工程设计 §3-4）。
 */

const noteKeys = new Map<string, Uint8Array>();
let lastActivity = Date.now();
export const LOCK_TIMEOUT_MS = 15 * 60_000;

const listeners = new Set<() => void>();
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

export function touchActivity(): void {
  lastActivity = Date.now();
}

export function lockItem(itemId: string): void {
  noteKeys.delete(itemId);
  bump();
}

/** 不活动超时（FR-ENC-4）：丢弃全部会话密钥。由调度器定期调用检查。 */
export function lockIfIdle(now = Date.now()): boolean {
  if (noteKeys.size > 0 && now - lastActivity > LOCK_TIMEOUT_MS) {
    noteKeys.clear();
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

/** 单篇离开即重锁（FR-ENC-4）——NoteDocument 卸载时调用。 */
export function lockOnLeave(itemId: string): void {
  if (noteKeys.has(itemId)) lockItem(itemId);
}
