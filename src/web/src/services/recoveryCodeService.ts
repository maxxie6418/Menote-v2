import {
  parseRecoveryCodeBinding, type KeyWrap, type RecoveryCodeRotationRequest,
  type RecoveryCodeRotationState, type RecoveryCodeState,
} from "@menote/shared";
import { localDb } from "../db/localDb";
import { generateContentKey, generateRecoveryCode, unwrapContentKey, wrapContentKey } from "./cryptoService";

const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){7}$/;

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
  if (!RECOVERY_CODE_PATTERN.test(code)) throw new Error("recovery_code_mismatch");
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

export function createRecoveryCodeRotation(): { id: string; code: string } {
  return { id: crypto.randomUUID(), code: generateRecoveryCode() };
}

async function readRotationState(url: string): Promise<RecoveryCodeRotationState> {
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (response.status === 409) {
      const error = await response.json() as { error?: string };
      if (error.error === "recovery_code_wrap_missing") throw new Error("recovery_code_wrap_missing");
    }
    if (!response.ok) throw new Error();
    const state = await response.json() as Partial<RecoveryCodeRotationState>;
    const binding = parseRecoveryCodeBinding(state.binding);
    if ((!binding && state.binding !== null) || !Number.isSafeInteger(state.revision) ||
        state.revision === undefined || !Array.isArray(state.wraps)) throw new Error();
    return { binding, revision: state.revision, wraps: state.wraps };
  } catch (error) {
    if (error instanceof Error && error.message === "recovery_code_wrap_missing") throw error;
    throw new Error("recovery_code_unavailable");
  }
}

async function unwrapWithCodes(wrap: KeyWrap, codes: readonly string[]): Promise<Uint8Array> {
  for (const code of codes) {
    try {
      return await unwrapContentKey(wrap, code);
    } catch {
      // A legacy account may have different codes for different recovery wraps.
    }
  }
  throw new Error("recovery_code_mismatch");
}

export async function prepareRecoveryCodeRotation(
  state: RecoveryCodeRotationState, oldCodes: readonly string[], next: { id: string; code: string },
): Promise<RecoveryCodeRotationRequest> {
  const codes = [...new Set(oldCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))];
  if (!state.binding && !state.wraps.length) throw new Error("recovery_rotation_empty");
  if (!codes.length || codes.some((code) => !RECOVERY_CODE_PATTERN.test(code))) throw new Error("recovery_rotation_format");
  if (!RECOVERY_CODE_PATTERN.test(next.code) || codes.includes(next.code)) throw new Error("recovery_rotation_format");
  if (state.binding) {
    const verifierKey = await unwrapWithCodes(state.binding.verifier, codes);
    verifierKey.fill(0);
  }
  const wraps: RecoveryCodeRotationRequest["wraps"] = [];
  for (const entry of state.wraps) {
    const rawKey = await unwrapWithCodes(entry.wrap, codes);
    try {
      const wrap = await wrapContentKey(rawKey, next.code, "recovery", entry.wrap.generation + 1);
      wraps.push({ kind: entry.kind, id: entry.id, wrap: { ...wrap, recoveryCodeId: next.id } });
    } finally { rawKey.fill(0); }
  }
  const verifierKey = generateContentKey();
  try {
    const verifier = await wrapContentKey(verifierKey, next.code, "recovery");
    return { revision: state.revision, binding: { id: next.id, verifier }, wraps };
  } finally { verifierKey.fill(0); }
}

async function submitRotation(userId: string, url: string, request: RecoveryCodeRotationRequest): Promise<void> {
  let conflict = false;
  try {
    const response = await fetch(url, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
    conflict = response.status === 409;
    if (response.ok) {
      const result = await response.json() as { binding?: unknown };
      if (parseRecoveryCodeBinding(result.binding)?.id === request.binding.id) return;
    }
  } catch {
    // The transaction may have committed before the response was lost.
  }
  const state = await fetchRecoveryCodeState(userId).catch(() => null);
  if (state?.binding?.id === request.binding.id) return;
  throw new Error(conflict ? "recovery_rotation_conflict" : "recovery_rotation_unconfirmed");
}

export async function rotateRecoveryCode(
  userId: string, oldCodes: readonly string[], next: { id: string; code: string },
): Promise<"synced" | "pending_sync"> {
  const url = `/api/recovery-code/rotation?account=${encodeURIComponent(userId)}`;
  const { requestSyncNow, syncQueueStatus } = await import("./syncEngine");
  const initial = await fetchRecoveryCodeState(userId);
  if (initial.binding?.id !== next.id) {
    // Drain the local queue outside the recovery lock. An editor save can need this same lock.
    if (!await requestSyncNow(userId)) throw new Error("recovery_rotation_sync_required");
    await withRecoveryCodeLock(userId, async () => {
      if ((await syncQueueStatus(userId)).pending) throw new Error("recovery_rotation_sync_required");
      const current = await readRotationState(url);
      if (current.binding?.id === next.id) return;
      const request = await prepareRecoveryCodeRotation(current, oldCodes, next);
      await submitRotation(userId, url, request);
    });
  }
  return await requestSyncNow(userId) ? "synced" : "pending_sync";
}
