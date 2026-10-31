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
  secret: string; schedule: "manual" | "daily" | "weekly"; name?: string;
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

export async function updateTarget(id: string, patch: { enabled?: boolean; schedule?: "manual" | "daily" | "weekly" }): Promise<void> {
  await fetch(`/api/backup/targets/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
  }).catch(() => {});
}

export async function deleteTarget(id: string): Promise<void> {
  await fetch(`/api/backup/targets/${id}`, { method: "DELETE" }).catch(() => {});
}
