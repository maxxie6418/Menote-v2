import { useEffect, useState } from "react";
import { AI_MODEL_OPTIONS, type AiSettings, type AiUsageSummary } from "@menote/shared";
import { readAiSettings, updateAiSettings } from "../../services/aiSettingsService";
import { readAiUsage } from "../../services/aiService";

/** AI 助手设置节（FR-AI-2）：开关、模型切换、每日额度；用量为本应用精确计数（区别于官方账单口径）。 */
export function AiSection({ userId }: { userId: string }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [limitDraft, setLimitDraft] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void readAiSettings(userId).then((value) => { if (!cancelled) setSettings(value); }); };
    refresh();
    window.addEventListener("menote:ai-settings", refresh);
    return () => { cancelled = true; window.removeEventListener("menote:ai-settings", refresh); };
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void readAiUsage(controller.signal).then((value) => { if (value) setUsage(value); }).catch(() => {});
    return () => controller.abort();
  }, [settings]);

  if (!settings) return <p className="mn-sethint">设置加载中…</p>;

  return (
    <div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">启用 AI 助手</p>
          <p className="mn-sethint">手动触发：为笔记生成摘要、推荐标签。推理经 Cloudflare Workers AI（原生绑定，无需额外密钥）；结果确认后才写入。加密内容不会提交云端 AI。关闭后不影响任何编辑功能。</p>
        </div>
        <input type="checkbox" aria-label="启用 AI 助手" checked={settings.enabled}
          onChange={(event) => void updateAiSettings(userId, { enabled: event.target.checked }).then(setSettings)} />
      </div>
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">模型</p>
          <p className="mn-sethint">候选模型可在当期 Workers AI 目录调整；部署时需核验目录可用性与 Neurons 定价（TP8 核验义务）。</p>
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
          <p className="mn-sethint">应用内预算（1–500 次/日）：达限后当日拒绝新任务，保护免费档 10,000 Neurons/日额度；以 Cloudflare 官方当期定价为准。</p>
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
      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">今日用量（本应用计数）</p>
          <p className="mn-sethint">
            {usage
              ? `${usage.day}：${usage.calls}/${usage.dailyCallLimit} 次调用 · 输入 ${usage.inputTokens} / 输出 ${usage.outputTokens} tokens。免费档约 ${usage.freeNeuronsDaily.toLocaleString()} Neurons/日，仅供参考。`
              : "暂无当日数据（需登录后可读）。"}
          </p>
        </div>
      </div>
    </div>
  );
}
