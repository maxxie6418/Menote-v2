import type { BackupTarget } from "@menote/shared";

/** 备份目标客户端（G9）：UI 经此访问 /api/backup，禁止直连 fetch。 */

export type { BackupTarget };

export interface TargetView extends BackupTarget {
  secretCiphertext: string | null;
  lastResult: string | null;
}

export async function listTargets(): Promise<TargetView[]> {
  try {
    const response = await fetch("/api/backup/targets", { cache: "no-store" });
    const body: unknown = await response.json();
    const targets = (body as { targets?: TargetView[] }).targets;
    return Array.isArray(targets) ? targets : [];
  } catch {
    return [];
  }
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

export async function listRemoteBackups(id: string): Promise<{ backups: Array<{ id: string; lastModified: string | null; complete: boolean }>; error?: string }> {
  try {
    const response = await fetch(`/api/backup/targets/${id}/backups`, { cache: "no-store" });
    const body = await response.json() as { backups?: Array<{ id: string; lastModified: string | null; complete: boolean }>; error?: string };
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

export async function runTargetOnce(id: string): Promise<{ ok: boolean; shards?: number; error?: string }> {
  try {
    const response = await fetch(`/api/backup/run/${id}`, { method: "POST" });
    return (await response.json().catch(() => ({}))) as { ok: boolean; shards?: number; error?: string };
  } catch (cause) {
    return { ok: false, error: String(cause) };
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

export async function updateTarget(id: string, patch: { enabled?: boolean; schedule?: "manual" | "daily" | "weekly" }): Promise<boolean> {
  const response = await fetch(`/api/backup/targets/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  }).catch(() => null);
  return response?.ok ?? false;
}

export async function deleteTarget(id: string): Promise<void> {
  await fetch(`/api/backup/targets/${id}`, { method: "DELETE" }).catch(() => {});
}
