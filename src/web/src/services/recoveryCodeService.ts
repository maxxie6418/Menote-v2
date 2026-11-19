import { parseRecoveryCodeBinding, type KeyWrap, type RecoveryCodeState } from "@menote/shared";
import { localDb } from "../db/localDb";
import { generateContentKey, generateRecoveryCode, unwrapContentKey, wrapContentKey } from "./cryptoService";

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
  const [local, remote] = await Promise.all([accountRecoveryWraps(userId), fetchRecoveryCodeState(userId)]);
  return local.length > 0 || remote.binding !== null || remote.legacyWraps.length > 0;
}

/** 校验所有现存包装，避免旧版多恢复码账户被误认为已经统一。 */
export async function enforceRecoveryCode(userId: string, supplied?: string): Promise<string> {
  const wraps = await accountRecoveryWraps(userId);
  const code = supplied?.trim();
  if (wraps.length === 0) return code || generateRecoveryCode();
  if (!code) throw new Error("recovery_code_required");
  await verifyWraps(wraps, code);
  return code;
}

async function verifyWraps(wraps: KeyWrap[], code: string): Promise<void> {
  for (const wrap of wraps) {
    try {
      const key = await unwrapContentKey(wrap, code);
      key.fill(0);
    } catch {
      throw new Error("recovery_code_mismatch");
    }
  }
}

async function fetchRecoveryCodeState(
  userId: string, claim?: { revision: number; binding: NonNullable<RecoveryCodeState["binding"]> },
): Promise<RecoveryCodeState> {
  try {
    const response = await fetch(`/api/recovery-code?account=${encodeURIComponent(userId)}`, {
      method: claim ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      ...(claim ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(claim) } : {}),
    });
    if (!response.ok && !(claim && response.status === 409)) throw new Error();
    const body = await response.json() as Partial<RecoveryCodeState>;
    const binding = parseRecoveryCodeBinding(body.binding);
    if (binding) return { binding };
    if (body.binding === null && typeof body.revision === "number" && Array.isArray(body.legacyWraps)) {
      return { binding: null, revision: body.revision, legacyWraps: body.legacyWraps };
    }
    throw new Error();
  } catch {
    throw new Error("recovery_code_unavailable");
  }
}

/** Reserve the account binding online before making any local changes. */
export async function registerRecoveryCode(userId: string, supplied?: string): Promise<{ code: string; bindingId: string }> {
  const code = await enforceRecoveryCode(userId, supplied);
  // Never adopt a low-entropy string, even if a caller bypasses the setup dialog.
  if (!/^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){7}$/.test(code)) throw new Error("recovery_code_mismatch");
  let state = await fetchRecoveryCodeState(userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (state.binding) {
      await verifyWraps([state.binding.verifier], code);
      return { code, bindingId: state.binding.id };
    }
    await verifyWraps(state.legacyWraps, code);
    const random = generateContentKey();
    try {
      const binding = { id: crypto.randomUUID(), verifier: await wrapContentKey(random, code, "recovery") };
      state = await fetchRecoveryCodeState(userId, { revision: state.revision, binding });
      if (state.binding?.id === binding.id) return { code, bindingId: binding.id };
    } finally { random.fill(0); }
  }
  if (state.binding) {
    await verifyWraps([state.binding.verifier], code);
    return { code, bindingId: state.binding.id };
  }
  throw new Error("recovery_code_unavailable");
}
