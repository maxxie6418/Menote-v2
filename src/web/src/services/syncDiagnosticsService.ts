import { localDb, type SyncDiagnosticRow } from "../db/localDb";
export type { SyncDiagnosticRow } from "../db/localDb";

const MAX_LOG_ROWS_PER_USER = 2_000;
const PRUNE_EVERY = 100;
const VISIBLE_LOG_ROWS = MAX_LOG_ROWS_PER_USER;

let writeChain: Promise<void> = Promise.resolve();
let writesSincePrune = 0;
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleNotify(): void {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined;
    listeners.forEach((listener) => listener());
  }, 250);
}

/** 诊断写入永不阻塞内容或同步流程；失败只丢诊断事件，不影响业务。 */
export function recordSyncDiagnostic(
  userId: string,
  event: Omit<SyncDiagnosticRow, "id" | "userId" | "at">,
): void {
  if (!userId) return;
  const row: SyncDiagnosticRow = { ...event, userId, at: Date.now() };
  writeChain = writeChain.then(async () => {
    await localDb.syncDiagnostics.add(row);
    writesSincePrune += 1;
    if (writesSincePrune >= PRUNE_EVERY) {
      writesSincePrune = 0;
      const rows = await localDb.syncDiagnostics.where("userId").equals(userId).toArray();
      // 预留一批日志的缓冲，避免在下一次清理前突破上限。
      if (rows.length > MAX_LOG_ROWS_PER_USER - PRUNE_EVERY) {
        rows.sort((a, b) => a.at - b.at);
        await localDb.syncDiagnostics.bulkDelete(rows.slice(0, rows.length - (MAX_LOG_ROWS_PER_USER - PRUNE_EVERY)).map((entry) => entry.id!));
      }
    }
  }).then(() => {
    scheduleNotify();
  }).catch(() => {});
}

export async function listSyncDiagnostics(userId: string): Promise<SyncDiagnosticRow[]> {
  await writeChain;
  const rows = await localDb.syncDiagnostics.where("userId").equals(userId).toArray();
  rows.sort((a, b) => b.at - a.at);
  return rows.slice(0, VISIBLE_LOG_ROWS);
}

export async function clearSyncDiagnostics(userId: string): Promise<void> {
  await writeChain;
  const rows = await localDb.syncDiagnostics.where("userId").equals(userId).toArray();
  await localDb.syncDiagnostics.bulkDelete(rows.map((entry) => entry.id!));
  listeners.forEach((listener) => listener());
}

export function subscribeSyncDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 最近一次完整同步轮次完成时间与最近一次错误（设置页同步摘要用；日志按时间倒序，先到先得）。 */
export async function lastSyncCycleSummary(userId: string): Promise<{ completedAt: number | null; lastError: { at: number; code: string } | null }> {
  await writeChain;
  const rows = await localDb.syncDiagnostics.where("userId").equals(userId).toArray();
  rows.sort((a, b) => b.at - a.at);
  let completedAt: number | null = null;
  let lastError: { at: number; code: string } | null = null;
  for (const row of rows) {
    if (completedAt === null && row.category === "cycle" && row.event === "sync_cycle_completed") completedAt = row.at;
    if (lastError === null && row.category === "error" && row.code) lastError = { at: row.at, code: row.code };
    if (completedAt !== null && lastError !== null) break;
  }
  return { completedAt, lastError };
}
