import { useEffect, useState } from "react";
import { DEFAULT_MONITOR_PREFERENCES, type MonitorPreferences, type MonitorSummary } from "@menote/shared";
import { getMonitorSummary } from "../../services/monitor";
import { loadMonitorPreferences, saveMonitorPreferences, validPreferences } from "../../services/monitor-preferences";

export default function MonitorPanel({ refresh }: { refresh: number }) {
  const [period, setPeriod] = useState<MonitorSummary["period"]>("utc_day");
  const [summary, setSummary] = useState<MonitorSummary | null>(null);
  const [monitorState, setMonitorState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [preferences, setPreferences] = useState<MonitorPreferences>({ ...DEFAULT_MONITOR_PREFERENCES });
  const [draft, setDraft] = useState<MonitorPreferences>({ ...DEFAULT_MONITOR_PREFERENCES });
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    loadMonitorPreferences().then((value) => { if (active) { setPreferences(value); setDraft(value); } })
      .catch(() => { if (active) setMessage("无法读取本机设置，暂使用默认值。"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setSummary(null);
    setMonitorState("loading");
    getMonitorSummary(period, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setSummary(value);
      setMonitorState(value ? "ready" : "unavailable");
    }).catch(() => {});
    return () => controller.abort();
  }, [period, refresh, tick]);
  useEffect(() => {
    const now = Date.now();
    const date = new Date(now);
    const boundary = period === "utc_day"
      ? Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
      : Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    const timer = setTimeout(() => setTick((value) => value + 1), Math.min(60_000, Math.max(1, boundary - now)));
    return () => clearTimeout(timer);
  }, [period, tick]);

  async function save() {
    if (!validPreferences(draft)) { setMessage("请输入正整数额度，且阈值须递增并在 1–100 之间。"); return; }
    try { await saveMonitorPreferences(draft); setPreferences(draft); setMessage("已保存在此浏览器。"); }
    catch { setMessage("无法保存设置，请检查浏览器存储权限。"); }
  }

  const ratio = period === "utc_day" && summary?.estimatedRequests != null
    ? summary.estimatedRequests / preferences.dailyQuota * 100 : null;
  const risk = ratio === null ? "暂无评估" : ratio >= preferences.critical ? "高风险" : ratio >= preferences.warning ? "警告" : ratio >= preferences.reminder ? "提醒" : "未触及阈值";
  const update = (key: keyof MonitorPreferences, value: string) => setDraft((old) => ({ ...old, [key]: Number(value) }));

  return <section className="status-card" aria-labelledby="monitor-heading">
    <h2 id="monitor-heading" className="status-title">资源监控 · 基础模式</h2>
    <p className="status-detail">仅本应用 API 请求的 1% 抽样估算；不是官方账单或账户总用量。小样本可能偏差很大。</p>
    <label className="monitor-label">统计周期 <select value={period} onChange={(event) => setPeriod(event.target.value as MonitorSummary["period"])}><option value="utc_day">今日（UTC）</option><option value="utc_month">本月（UTC）</option></select></label>
    <p className="status-detail">{monitorState === "loading" ? "正在获取采样数据。" : monitorState === "unavailable" ? "监控暂不可用，请稍后重试。" : summary?.estimatedRequests == null ? "当前周期没有可用样本，暂无法估算。" : `估算 ${summary.estimatedRequests.toLocaleString()} 次（${summary.sampleCount} 个样本）`}</p>
    {period === "utc_day" && <p className="status-detail">参考额度每日 {preferences.dailyQuota.toLocaleString()} 次；{ratio === null ? risk : `占参考额度约 ${ratio.toFixed(1)}%，${risk}`}。</p>}
    {ratio !== null && summary?.estimatedRequests != null && <p className="status-detail">相对本机参考额度余量约 {Math.max(0, preferences.dailyQuota - summary.estimatedRequests).toLocaleString()} 次；请到 Cloudflare 核对账户实际用量。</p>}
    <p className="status-detail">额度由账户内所有应用共享；预警不是收费上限，统计可能延迟，页面数据最多缓存 1 分钟。</p>
    <p className="status-detail">CPU、D1 与 R2 账户用量和官方账单当前不可获取。</p>
    {summary && summary.points.length > 0 && <details className="monitor-settings"><summary>{period === "utc_day" ? "查看今日小时趋势（UTC）" : "查看本月每日趋势（UTC）"}</summary>
      <p className="status-detail">只列出有样本的时间段，未列出的时间段不代表零使用。</p>
      <ol className="monitor-trend">{summary.points.map((point) => <li key={point.bucketAt}>
        <time dateTime={new Date(point.bucketAt).toISOString()}>{new Intl.DateTimeFormat("zh-CN", { timeZone: "UTC", month: "2-digit", day: "2-digit", ...(period === "utc_day" ? { hour: "2-digit", hourCycle: "h23" } : {}) }).format(point.bucketAt)}</time>
        {`：约 ${point.estimatedRequests.toLocaleString()} 次（${point.sampleCount} 个样本）`}
      </li>)}</ol>
    </details>}
    {summary && <p className="status-detail">本周期成功记录 {summary.sampleCount} 次采样写入（不含其他 D1 用量）。</p>}
    <p className="status-detail">{summary?.sampledAt ? `最近采样：${new Date(summary.sampledAt).toLocaleString()}` : "尚无采样时间。"}</p>
    <details className="monitor-settings"><summary>调整本机参考额度与阈值</summary>
      <p className="status-detail">设置只保存在此浏览器，默认值参考 Cloudflare 免费方案；不会改变 Cloudflare 配额。</p>
      <div className="monitor-fields">
        <label>每日参考额度 <input type="number" min="1" step="1" value={draft.dailyQuota} onChange={(event) => update("dailyQuota", event.target.value)} /></label>
        <label>提醒 % <input type="number" min="1" max="100" value={draft.reminder} onChange={(event) => update("reminder", event.target.value)} /></label>
        <label>警告 % <input type="number" min="1" max="100" value={draft.warning} onChange={(event) => update("warning", event.target.value)} /></label>
        <label>高风险 % <input type="number" min="1" max="100" value={draft.critical} onChange={(event) => update("critical", event.target.value)} /></label>
      </div>
      <button type="button" className="app-button" onClick={save}>保存设置</button>
      <p className="status-detail" role="status">{message}</p>
    </details>
  </section>;
}
