import { useEffect, useState } from "react";
import { AI_MODEL_OPTIONS, DEFAULT_AI_SETTINGS, normalizeAiSettings, type AiSettings, type AiUsageSummary } from "@menote/shared";
import { readAiSettings, updateAiSettings } from "../../services/aiSettingsService";
import { readAiUsage } from "../../services/aiService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";
import { SettingsGroup } from "./SettingsGroup";

/** AI 助手设置节（FR-AI-2）：开关、模型切换、每日额度；用量为本应用精确计数（区别于官方账单口径）。 */
export function AiSection({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<AiSettings | null>(() => {
    const cached = peek<AiSettings | null>(SETTINGS_CACHE.ai(userId));
    if (cached === undefined) return null;
    return cached ? normalizeAiSettings(cached) : { ...DEFAULT_AI_SETTINGS };
  });
  const [usage, setUsage] = useState<AiUsageSummary | null>(() => peek<AiUsageSummary | null>(SETTINGS_CACHE.usage) ?? null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = (fresh: boolean) => {
      void loadShared(SETTINGS_CACHE.ai(userId), () => readAiSettings(userId), fresh).then((value) => {
        // 无本地记录时服务返回 null，由调用方回退默认（关闭）。不能把 null 一直当成加载中。
        if (!cancelled) setSettings(value ? normalizeAiSettings(value) : { ...DEFAULT_AI_SETTINGS });
      });
    };
    refresh(false);
    const onChange = () => refresh(true);
    window.addEventListener("menote:ai-settings", onChange);
    return () => { cancelled = true; window.removeEventListener("menote:ai-settings", onChange); };
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void loadShared(SETTINGS_CACHE.usage, () => readAiUsage()).then((value) => { if (!cancelled && value) setUsage(value); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [settings]);

  if (!settings) return <p className="mn-sethint">设置加载中…</p>;

  return (
    <div className="mn-settings-stack">
      <section className="mn-settings-card mn-settings-status" aria-label="AI 用量">
        <h3>今日用量</h3>
        {usage ? <dl className="mn-settings-metrics">
          <div><dt>调用次数</dt><dd>{usage.calls} / {usage.dailyCallLimit}</dd></div>
          <div><dt>输入 Token</dt><dd>{usage.inputTokens.toLocaleString()}</dd></div>
          <div><dt>输出 Token</dt><dd>{usage.outputTokens.toLocaleString()}</dd></div>
        </dl> : <p className="mn-sethint">暂无当日用量。</p>}
      </section>
      <SettingsGroup title="使用设置">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">启用 AI 助手</p>
            <p className="mn-sethint">可手动生成笔记摘要和推荐标签。加密内容不会发送给 AI。</p>
          </div>
          <input type="checkbox" aria-label="启用 AI 助手" checked={settings.enabled}
            onChange={(event) => void updateAiSettings(userId, { enabled: event.target.checked }).then(setSettings)} />
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">模型</p>
          </div>
          <select className="mn-propselect" aria-label="AI 模型" value={settings.model}
            onChange={(event) => void updateAiSettings(userId, { model: event.target.value }).then(setSettings)}>
            {AI_MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">每日调用上限</p>
            <p className="mn-sethint">每天允许 1–500 次。达到上限后，次日恢复调用。</p>
          </div>
          <input type="number" className="mn-propselect" min={1} max={500} aria-label="每日调用上限"
            value={limitDraft ?? String(settings.dailyCallLimit)}
            onChange={(event) => setLimitDraft(event.target.value)}
            onBlur={() => {
              const parsed = Number.parseInt(limitDraft ?? "", 10);
              setLimitDraft(null);
              if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 500 && parsed !== settings.dailyCallLimit) {
                void updateAiSettings(userId, { dailyCallLimit: parsed }).then(setSettings);
              }
            }} />
        </div>
      </SettingsGroup>
    </div>
  );
}
