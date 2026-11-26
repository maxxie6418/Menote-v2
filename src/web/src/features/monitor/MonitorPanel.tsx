import { useEffect, useState } from "react";
import { DEFAULT_MONITOR_PREFERENCES, type MonitorPreferences, type MonitorSummary } from "@menote/shared";
import { RefreshCw } from "../../icons";
import { getMonitorSummary } from "../../services/monitorService";
import { loadMonitorPreferences, saveMonitorPreferences, validPreferences } from "../../services/monitorPreferencesService";

export default function MonitorPanel() {
  const [period, setPeriod] = useState<MonitorSummary["period"]>("utc_week");
  const [local, setLocal] = useState<MonitorSummary | null>(null);
  const [preferences, setPreferences] = useState<MonitorPreferences>({ ...DEFAULT_MONITOR_PREFERENCES });
  const [draftPreferences, setDraftPreferences] = useState(preferences);
  const [message, setMessage] = useState("");
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void loadMonitorPreferences().then(prefs => {
      if (active) { setPreferences(prefs); setDraftPreferences(prefs); }
    }).catch(() => { if (active) setMessage("无法读取监控设置。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void getMonitorSummary(period, controller.signal, tick > 0).then(value => {
      if (!controller.signal.aborted) { setLocal(value); setLoading(false); }
    }).catch(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, tick]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") setTick(value => value + 1); }, preferences.refreshIntervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [preferences.refreshIntervalMinutes]);

  async function updateInterval(value: string) {
    const next = { ...preferences, refreshIntervalMinutes: Number(value) };
    try { await saveMonitorPreferences(next); setPreferences(next); setDraftPreferences(next); setMessage(`自动刷新已设为每 ${next.refreshIntervalMinutes} 分钟。`); }
    catch { setMessage("保存刷新频率失败。"); }
  }
  async function saveThresholds() {
    if (!validPreferences(draftPreferences)) { setPreferencesMessage("参考额度需为正整数，阈值需递增且不超过 100%。"); return; }
    try { await saveMonitorPreferences(draftPreferences); setPreferences(draftPreferences); setPreferencesMessage("已保存到此浏览器。"); }
    catch { setPreferencesMessage("保存监控阈值失败。"); }
  }

  const updateThreshold = (key: "dailyQuota" | "reminder" | "warning" | "critical", value: string) => setDraftPreferences((old) => ({ ...old, [key]: Number(value) }));
  const requestPercent = period !== "utc_day" || local?.estimatedRequests == null ? null : Math.min(100, local.estimatedRequests / preferences.dailyQuota * 100);
  const riskLabel = requestPercent === null ? "暂无评估" : requestPercent >= preferences.critical ? "高风险" : requestPercent >= preferences.warning ? "警告" : requestPercent >= preferences.reminder ? "提醒" : "正常";
  return <div className="mn-monitor">
    <div className="mn-monitor-deskbar">
      <div className="mn-monitor-range" role="group" aria-label="统计周期">
        {([["utc_day", "今天"], ["utc_week", "近 7 天"], ["utc_month", "本月"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
      </div>
      <div className="mn-monitor-toolbar">
        <label>自动刷新<select value={preferences.refreshIntervalMinutes} onChange={(event) => void updateInterval(event.target.value)}>
          <option value={5}>5 分钟</option><option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>60 分钟</option>
        </select></label>
        <button type="button" className="app-button mn-refresh-button" onClick={() => setTick((value) => value + 1)} disabled={loading}><RefreshCw aria-hidden="true" />{loading ? "刷新中" : "立即刷新"}</button>
      </div>
    </div>
    <section className="mn-monitor-section" aria-labelledby="mn-project-heading">
      <h2 id="mn-project-heading">应用内部抽样统计</h2>
      <p className="mn-monitor-caption">来自本应用的请求抽样估算，覆盖当前 Docker 实例。</p>
      <div className="mn-monitor-project"><strong>{local?.estimatedRequests == null ? "暂无可用样本" : `约 ${local.estimatedRequests.toLocaleString()} 次请求`}</strong><span>{local?.sampleCount ?? 0} 个样本 · {local?.sampledAt ? `最后采样 ${new Date(local.sampledAt).toLocaleString()}` : "尚无采样时间"}</span>{requestPercent !== null && <span>{riskLabel} · 本机参考值 {requestPercent.toFixed(1)}%</span>}</div>
      <details className="mn-monitor-preferences"><summary>应用内估算额度与提醒阈值</summary><p className="mn-monitor-caption">只用于本机抽样估算提醒，按本机设置计算。</p>
        <div className="mn-monitor-form">
          <label>每日参考请求数<input type="number" min="1" step="1" value={draftPreferences.dailyQuota} onChange={(event) => updateThreshold("dailyQuota", event.target.value)} /></label>
          <label>提醒阈值 %<input type="number" min="1" max="100" value={draftPreferences.reminder} onChange={(event) => updateThreshold("reminder", event.target.value)} /></label>
          <label>警告阈值 %<input type="number" min="1" max="100" value={draftPreferences.warning} onChange={(event) => updateThreshold("warning", event.target.value)} /></label>
          <label>高风险阈值 %<input type="number" min="1" max="100" value={draftPreferences.critical} onChange={(event) => updateThreshold("critical", event.target.value)} /></label>
        </div><button type="button" className="app-button" onClick={() => void saveThresholds()}>保存提醒设置</button><p className="mn-monitor-message" role="status">{preferencesMessage}</p>
      </details>
    </section>

    {message && <p role="status">{message}</p>}
  </div>;
}
