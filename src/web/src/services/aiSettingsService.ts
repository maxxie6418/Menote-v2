import { AI_SETTING_KEY, type AiSettings, type UserSetting } from "@menote/shared";
import { localDb } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";

/** AI 助手设置（FR-AI-2）：随 user_settings 同步（与外观偏好同链路）；值为普通敏感度。 */

export async function saveAiSettings(userId: string, value: AiSettings): Promise<void> {
  let setting!: UserSetting;
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, AI_SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === AI_SETTING_KEY).sort((a, b) => a.seq! - b.seq!);
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const rev = baseRev + 1;
    setting = { userId, key: AI_SETTING_KEY, sensitivity: "ordinary", value, rev, updatedAt: Date.now() };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{
      operationId: newId(), userId, entityId: AI_SETTING_KEY, entity: "setting", action: "upsert",
      baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0,
      nextRetryAt: null, lastError: null,
    }]);
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:ai-settings"));
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
}

/** 读取本机已同步的 AI 设置；无记录返回 null（由调用方回退共享默认值）。 */
export async function readAiSettings(userId: string): Promise<AiSettings | null> {
  const current = await localDb.settings.get([userId, AI_SETTING_KEY]);
  if (current?.sensitivity !== "ordinary") return null;
  return current.value as AiSettings;
}

export async function updateAiSettings(userId: string, patch: Partial<AiSettings>): Promise<AiSettings> {
  const { DEFAULT_AI_SETTINGS, normalizeAiSettings } = await import("@menote/shared");
  const current = await readAiSettings(userId);
  const next = normalizeAiSettings({ ...(current ?? DEFAULT_AI_SETTINGS), ...patch });
  await saveAiSettings(userId, next);
  return next;
}

/** 同步拉取覆盖本机后应用（供同步引擎在收到 settings 实体时调用）。 */
export async function applyPulledAiSettings(userId: string, settings: UserSetting[]): Promise<void> {
  const remote = settings.find((setting) => setting.key === AI_SETTING_KEY && setting.sensitivity === "ordinary");
  if (!remote) return;
  const pending = await localDb.outbox.where("userId").equals(userId).and((row) => row.entity === "setting" && row.entityId === AI_SETTING_KEY).count();
  if (pending > 0) return;
  await localDb.settings.put(remote);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("menote:ai-settings"));
}
