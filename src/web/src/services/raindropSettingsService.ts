import { RAINDROP_SETTING_KEY, type RaindropSettings, type UserSetting } from "@menote/shared";
import { localDb } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";

/** Raindrop 连接器插件开关（FR-EXT-3，TP9）：随 user_settings 同步（与外观偏好同链路）；值为普通敏感度。
 *  开关只 gate 连接器自身（设置页显隐 + 定时任务跳过），不影响应用其余功能。 */

export async function saveRaindropSettings(userId: string, value: RaindropSettings): Promise<void> {
  let setting!: UserSetting;
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, RAINDROP_SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === RAINDROP_SETTING_KEY).sort((a, b) => a.seq! - b.seq!);
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const rev = baseRev + 1;
    setting = { userId, key: RAINDROP_SETTING_KEY, sensitivity: "ordinary", value, rev, updatedAt: Date.now() };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{
      operationId: newId(), userId, entityId: RAINDROP_SETTING_KEY, entity: "setting", action: "upsert",
      baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0,
      nextRetryAt: null, lastError: null,
    }]);
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:raindrop-settings"));
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
}

/** 读取本机已同步的插件开关；无记录返回 null（由调用方回退共享默认值）。 */
export async function readRaindropSettings(userId: string): Promise<RaindropSettings | null> {
  const current = await localDb.settings.get([userId, RAINDROP_SETTING_KEY]);
  if (current?.sensitivity !== "ordinary") return null;
  return current.value as RaindropSettings;
}

export async function updateRaindropSettings(userId: string, patch: Partial<RaindropSettings>): Promise<RaindropSettings> {
  const { DEFAULT_RAINDROP_SETTINGS, normalizeRaindropSettings } = await import("@menote/shared");
  const current = await readRaindropSettings(userId);
  const next = normalizeRaindropSettings({ ...(current ?? DEFAULT_RAINDROP_SETTINGS), ...patch });
  await saveRaindropSettings(userId, next);
  return next;
}

/** 同步拉取覆盖本机后应用（供同步引擎在收到 settings 实体时调用）。 */
export async function applyPulledRaindropSettings(userId: string, settings: UserSetting[]): Promise<void> {
  const remote = settings.find((setting) => setting.key === RAINDROP_SETTING_KEY && setting.sensitivity === "ordinary");
  if (!remote) return;
  const pending = await localDb.outbox.where("userId").equals(userId)
    .and((row) => row.entity === "setting" && row.entityId === RAINDROP_SETTING_KEY).count();
  if (pending > 0) return;
  await localDb.settings.put(remote);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:raindrop-settings"));
}
