import { requestSyncNow } from "./syncEngine";
import type { AccountArchiveSummary, BackupTarget, RemoteBackup, RemoteBackupPushResult } from "@menote/shared";

export async function downloadAccountPackage(): Promise<void> {
  const response = await fetch("/api/backup/archive/download", { method: "POST", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `下载失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = response.headers.get("Content-Disposition")?.match(/filename="(menote-[\w-]+\.zip)"/)?.[1] ?? "menote-backup.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function uploadAccountArchive(file: File, restore: boolean): Promise<AccountArchiveSummary> {
  const response = await fetch("/api/backup/archive/" + (restore ? "restore" : "verify"), {
    method: "POST", headers: { "Content-Type": "application/zip" }, body: file,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error ?? `上传失败（HTTP ${response.status}）`);
  return body.result;
}

/** 备份目标客户端（G9）：UI 经此访问 /api/backup，禁止直连 fetch。 */

export type { BackupTarget };

export interface TargetView extends BackupTarget {
  secretCiphertext: string | null;
  lastResult: string | null;
}

export async function listTargets(): Promise<TargetView[]> {
  const response = await fetch("/api/backup/targets", { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body?.targets)) throw new Error("无法读取远端备份位置。");
  return body.targets;
}

export async function createTarget(input: {
  kind: "webdav" | "s3"; endpoint: string; bucket: string | null; username: string | null;
  secret: string; schedule: "manual" | "daily" | "weekly"; name?: string; remotePath: string; retentionCount: number;
}): Promise<boolean> {
  try {
    const response = await fetch("/api/backup/targets", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function testTarget(input: {
  kind: "webdav" | "s3"; endpoint: string; bucket: string | null; username: string | null; secret: string; remotePath: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch("/api/backup/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    return await response.json() as { ok: boolean; error?: string };
  } catch (error) { return { ok: false, error: String(error) }; }
}

export async function testSavedTarget(id: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/backup/targets/${id}/test`, { method: "POST" });
    return await response.json() as { ok: boolean; error?: string };
  } catch (error) { return { ok: false, error: String(error) }; }
}

export async function listRemoteBackups(id: string): Promise<{ backups: RemoteBackup[]; error?: string }> {
  try {
    const response = await fetch(`/api/backup/targets/${id}/backups`, { cache: "no-store" });
    const body = await response.json() as { backups?: RemoteBackup[]; error?: string };
    if (!response.ok) return { backups: [], error: body.error ?? `HTTP ${response.status}` };
    return { backups: Array.isArray(body.backups) ? body.backups : [], ...(body.error ? { error: body.error } : {}) };
  } catch (error) { return { backups: [], error: String(error) }; }
}

export async function deleteRemoteBackup(targetId: string, backupId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(`/api/backup/targets/${targetId}/backups/${encodeURIComponent(backupId)}`, { method: "DELETE" });
    const body = await response.json().catch(() => ({})) as { error?: string };
    return response.ok ? { ok: true } : { ok: false, error: body.error ?? `HTTP ${response.status}` };
  } catch (error) { return { ok: false, error: String(error) }; }
}

export async function verifyRemoteBackup(targetId: string, backupId: string): Promise<{ ok: boolean; files?: number; shards?: number; attachments?: number; error?: string }> {
  try {
    const response = await fetch(`/api/backup/targets/${targetId}/backups/${encodeURIComponent(backupId)}/verify`, { method: "POST" });
    return await response.json();
  } catch (error) { return { ok: false, error: String(error) }; }
}

export async function restoreRemoteBackup(targetId: string, backupId: string): Promise<{ ok: boolean; items?: number; topics?: number; memoComments?: number; settings?: number; attachments?: number; skipped?: number; error?: string }> {
  try {
    const response = await fetch(`/api/backup/targets/${targetId}/backups/${encodeURIComponent(backupId)}/restore`, { method: "POST" });
    return await response.json();
  } catch (error) { return { ok: false, error: String(error) }; }
}

export async function runTargetOnce(id: string): Promise<RemoteBackupPushResult> {
  try {
    const response = await fetch(`/api/backup/run/${id}`, { method: "POST" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok) return { ok: false, error: result?.error ?? `HTTP ${response.status}` };
    return result;
  } catch (cause) {
    return { ok: false, error: String(cause) };
  }
}

type BackupRunState = {
  running: boolean;
  status: string;
  results: ReadonlyArray<{ id: string; name: string; ok: boolean; detail: string; finishedAt: number }>;
};

const IDLE_BACKUP_RUN: BackupRunState = { running: false, status: "", results: [] };
const backupRuns = new Map<string, BackupRunState>();
const backupRunListeners = new Set<() => void>();

export function getBackupRun(userId: string): BackupRunState {
  return backupRuns.get(userId) ?? IDLE_BACKUP_RUN;
}

export function subscribeBackupRuns(listener: () => void): () => void {
  backupRunListeners.add(listener);
  return () => { backupRunListeners.delete(listener); };
}

export async function runBackups(userId: string, targets: ReadonlyArray<Pick<TargetView, "id" | "name">>, syncFirst: boolean): Promise<void> {
  if (getBackupRun(userId).running || !targets.length) return;
  const publish = (patch: Partial<BackupRunState>) => {
    backupRuns.set(userId, { ...getBackupRun(userId), ...patch });
    backupRunListeners.forEach(listener => listener());
  };
  publish({ running: true, status: syncFirst ? "正在同步本机改动…" : "正在准备备份…", results: [] });
  let failure = "";
  try {
    if (syncFirst && !await requestSyncNow(userId)) {
      failure = "本机改动尚未确认同步，请先检查同步状态。";
      return;
    }
    for (const target of targets) {
      const name = target.name || "备份位置";
      publish({ status: "正在推送并校验「" + name + "」…" });
      const result = await runTargetOnce(target.id);
      const detail = result.ok
        ? "已保存 " + result.shards + " 个数据分片" + (result.cleanupError ? "，旧备份清理失败" : "")
        : result.error;
      publish({ results: [...getBackupRun(userId).results, { id: target.id, name, ok: result.ok, detail, finishedAt: Date.now() }] });
    }
  } catch {
    failure = "未能完成本轮备份，请查看各目标结果后重试。";
  } finally {
    publish({ running: false, status: failure });
  }
}

export async function revealSecret(id: string): Promise<string | null> {
  try {
    const response = await fetch(`/api/backup/targets/${id}/secret`, { cache: "no-store" });
    const body: { secret?: string } = await response.json().catch(() => ({}));
    return typeof body.secret === "string" ? body.secret : null;
  } catch {
    return null;
  }
}

export async function updateTarget(id: string, patch: { enabled?: boolean; retentionCount?: number; schedule?: "manual" | "daily" | "weekly" }): Promise<boolean> {
  const response = await fetch(`/api/backup/targets/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  }).catch(() => null);
  return response?.ok ?? false;
}

export async function deleteTarget(id: string): Promise<boolean> {
  const response = await fetch(`/api/backup/targets/${id}`, { method: "DELETE" }).catch(() => null);
  return response?.ok ?? false;
}
