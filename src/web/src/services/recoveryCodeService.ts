import type { KeyWrap } from "@menote/shared";
import { localDb } from "../db/localDb";
import { generateRecoveryCode, unwrapContentKey } from "./cryptoService";

/** 同一浏览器的标签页共用 IndexedDB；恢复码检查与新包装写入必须持同一账户锁。
 *  没有 Web Locks 时不能安全串行化，明确拒绝，不退化为页面内锁。 */
export async function withRecoveryCodeLock<T>(userId: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    throw new Error("recovery_lock_unavailable");
  }
  return await navigator.locks.request(`menote-recovery-code:${userId}`, action);
}

/** 仅检查当前账户的包装；缺少单篇包装时不能误判为首次设置。 */
async function accountRecoveryWraps(userId: string): Promise<KeyWrap[]> {
  const [items, topics] = await Promise.all([
    localDb.items.where("userId").equals(userId).toArray(),
    localDb.topics.where("userId").equals(userId).toArray(),
  ]);
  const selfItems = items.filter((item) => item.content.scope === "self");
  const [itemRows, topicRows] = await Promise.all([
    localDb.wraps.bulkGet(selfItems.map((item) => item.id)),
    localDb.topicWraps.bulkGet(topics.filter((topic) => topic.isEncSpace).map((topic) => topic.id)),
  ]);
  const wraps: KeyWrap[] = [];
  for (const row of itemRows) {
    const wrap = row?.wraps.find((entry) => entry.wrapper === "recovery");
    if (!wrap) throw new Error("recovery_wrap_missing");
    wraps.push(wrap);
  }
  for (const row of topicRows) {
    if (!row) continue; // 尚未设置密码的私人空间占位主题。
    const wrap = row.wraps.find((entry) => entry.wrapper === "recovery");
    if (!wrap) throw new Error("recovery_wrap_missing");
    wraps.push(wrap);
  }
  return wraps;
}

export async function recoveryCodeExists(userId: string): Promise<boolean> {
  return (await accountRecoveryWraps(userId)).length > 0;
}

/** 校验所有现存包装，避免旧版多恢复码账户被误认为已经统一。 */
export async function enforceRecoveryCode(userId: string, supplied?: string): Promise<string> {
  const wraps = await accountRecoveryWraps(userId);
  const code = supplied?.trim();
  if (wraps.length === 0) return code || generateRecoveryCode();
  if (!code) throw new Error("recovery_code_required");
  for (const wrap of wraps) {
    try {
      const key = await unwrapContentKey(wrap, code);
      key.fill(0);
    } catch {
      throw new Error("recovery_code_mismatch");
    }
  }
  return code;
}
