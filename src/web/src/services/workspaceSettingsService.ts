import type { UserSetting } from "@menote/shared";
import { localDb } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";

export interface WorkspaceSettings {
  sidebarWidth: number;
  topicOrder: string[];
  groupOrder: Record<string, string[]>;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = { sidebarWidth: 248, topicOrder: [], groupOrder: {} };
const SETTING_KEY = "workspace";

function normalize(value: unknown): WorkspaceSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_WORKSPACE_SETTINGS;
  const raw = value as Partial<WorkspaceSettings>;
  const groupOrder = typeof raw.groupOrder === "object" && raw.groupOrder !== null ? raw.groupOrder : {};
  return {
    sidebarWidth: typeof raw.sidebarWidth === "number" ? Math.max(200, Math.min(420, raw.sidebarWidth)) : 248,
    topicOrder: Array.isArray(raw.topicOrder) ? raw.topicOrder.filter((id): id is string => typeof id === "string") : [],
    groupOrder: Object.fromEntries(Object.entries(groupOrder).map(([id, rows]) => [id, Array.isArray(rows) ? rows.filter((row): row is string => typeof row === "string") : []])),
  };
}

export function applyWorkspaceSettings(value: WorkspaceSettings): void {
  /* 存的是「标准档下的 px」，渲染时折成 rem：界面密度放大后侧栏跟着一起长，
     否则字号变大而侧栏不变宽，树标签会被挤断。 */
  if (typeof document !== "undefined") document.documentElement.style.setProperty("--mn-sidebar-width", `${value.sidebarWidth / 16}rem`);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:workspace-settings"));
}

export async function readWorkspaceSettings(userId: string): Promise<WorkspaceSettings> {
  const row = await localDb.settings.get([userId, SETTING_KEY]);
  return row?.sensitivity === "ordinary" ? normalize(row.value) : DEFAULT_WORKSPACE_SETTINGS;
}

export async function updateWorkspaceSettings(userId: string, patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
  let next!: WorkspaceSettings;
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === SETTING_KEY).sort((a, b) => a.seq! - b.seq!);
    const base = current?.sensitivity === "ordinary" ? normalize(current.value) : DEFAULT_WORKSPACE_SETTINGS;
    next = normalize({ ...base, ...patch, groupOrder: patch.groupOrder ?? base.groupOrder, topicOrder: patch.topicOrder ?? base.topicOrder });
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const setting: UserSetting = { userId, key: SETTING_KEY, sensitivity: "ordinary", value: next, rev: baseRev + 1, updatedAt: Date.now() };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{ operationId: newId(), userId, entityId: SETTING_KEY, entity: "setting", action: "upsert", baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0, nextRetryAt: null, lastError: null }]);
  });
  applyWorkspaceSettings(next);
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
  return next;
}

export async function applyPulledWorkspaceSettings(userId: string, settings: UserSetting[]): Promise<void> {
  const remote = settings.find((row) => row.key === SETTING_KEY && row.sensitivity === "ordinary");
  if (!remote || remote.sensitivity !== "ordinary") return;
  const pending = await localDb.outbox.where("userId").equals(userId).and((row) => row.entity === "setting" && row.entityId === SETTING_KEY).count();
  if (pending > 0) return;
  await localDb.settings.put(remote);
  applyWorkspaceSettings(normalize(remote.value));
}

export function orderIds(ids: string[], preferred: string[]): string[] {
  const rank = new Map(preferred.map((id, index) => [id, index]));
  return [...ids].sort((a, b) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER));
}
