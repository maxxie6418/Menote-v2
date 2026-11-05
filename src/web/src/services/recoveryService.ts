import { localDb, type RecoveryRow } from "../db/localDb";
import { decryptMarkdown, encryptMarkdown } from "./cryptoService";
import { getContentKey } from "./keyringService";
import { packEnvelope, unpackEnvelope } from "./contentShared";

/**
 * 崩溃恢复副本（FR-EDT-11）：只写本地 IndexedDB，不进 outbox、不同步、不进备份。
 * 加密笔记只用内容密钥密封后落盘；未解锁不写。明文不落盘。
 */

export type { RecoveryRow };

const timers = new Map<string, number>();
const THROTTLE_MS = 1_500;

export function shouldOfferRecovery(saved: string, snapshot: string | null): boolean {
  return snapshot !== null && snapshot !== saved;
}

export async function readRecovery(itemId: string): Promise<RecoveryRow | undefined> {
  return localDb.recovery.get(itemId);
}

/** 把快照还原成可保存的 Markdown。未解锁或解密失败返回 null，不把空串当正文。 */
export async function openRecoveryMarkdown(row: RecoveryRow): Promise<string | null> {
  if (row.scope === "plain") return row.content;
  const key = getContentKey(row.itemId);
  if (!key) return null;
  try {
    const envelope = unpackEnvelope(row.content);
    return decryptMarkdown(envelope, key);
  } catch {
    return null;
  }
}

export async function discardRecovery(itemId: string): Promise<void> {
  const pending = timers.get(itemId);
  if (pending !== undefined) window.clearTimeout(pending);
  timers.delete(itemId);
  await localDb.recovery.delete(itemId);
}

/** 节流写入。加密条目在没有会话密钥时直接跳过。 */
export function scheduleRecovery(userId: string, itemId: string, markdown: string, scope: "plain" | "sealed"): void {
  const pending = timers.get(itemId);
  if (pending !== undefined) window.clearTimeout(pending);
  timers.set(itemId, window.setTimeout(() => {
    timers.delete(itemId);
    void writeRecovery(userId, itemId, markdown, scope);
  }, THROTTLE_MS));
}

export async function writeRecovery(userId: string, itemId: string, markdown: string, scope: "plain" | "sealed"): Promise<void> {
  if (scope === "sealed") {
    const key = getContentKey(itemId);
    if (!key) return;
    const envelope = await encryptMarkdown(markdown, key);
    await localDb.recovery.put({
      itemId, userId, scope: "sealed", content: packEnvelope(envelope.iv, envelope.ciphertext), updatedAt: Date.now(),
    });
    return;
  }
  await localDb.recovery.put({ itemId, userId, scope: "plain", content: markdown, updatedAt: Date.now() });
}
