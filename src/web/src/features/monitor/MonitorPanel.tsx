import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_MONITOR_PREFERENCES, type CloudflareMonitorConnection, type CloudflareMonitorMetrics, type CloudflareMonitorSetup, type MonitorPreferences, type MonitorSummary } from "@menote/shared";
import { RefreshCw } from "lucide-react";
import { deleteCloudflareConnection, getCloudflareConnection, getCloudflareMetrics, getMonitorSummary, getSavedCloudflareToken, saveCloudflareConnection } from "../../services/monitorService";
import { loadMonitorPreferences, saveMonitorPreferences, validPreferences } from "../../services/monitorPreferencesService";

const EMPTY_SETUP: CloudflareMonitorSetup = { accountId: "", apiToken: "", scriptName: "menote-v2", d1DatabaseId: "", r2BucketName: "" };

export default function MonitorPanel({ refresh = 0 }: { refresh?: number }) {
  const [period, setPeriod] = useState<MonitorSummary["period"]>("utc_day");
  const [local, setLocal] = useState<MonitorSummary | null>(null);
  const [metrics, setMetrics] = useState<CloudflareMonitorMetrics | null>(null);
  const [connection, setConnection] = useState<CloudflareMonitorConnection | null>(null);
  const [preferences, setPreferences] = useState<MonitorPreferences>({ ...DEFAULT_MONITOR_PREFERENCES });
  const [draftPreferences, setDraftPreferences] = useState<MonitorPreferences>({ ...DEFAULT_MONITOR_PREFERENCES });
  const [setup, setSetup] = useState<CloudflareMonitorSetup>({ ...EMPTY_SETUP });
  const [savedToken, setSavedToken] = useState("");
  const [showSavedToken, setShowSavedToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preferencesMessage, setPreferencesMessage] = useState("");
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([getCloudflareConnection(controller.signal), loadMonitorPreferences()]).then(([value, prefs]) => {
      if (controller.signal.aborted) return;
      setConnection(value);
      setPreferences(prefs);
      setDraftPreferences(prefs);
      setSetup((current) => ({ ...current, accountId: value.accountId ?? current.accountId, scriptName: value.scriptName ?? current.scriptName, d1DatabaseId: value.d1DatabaseId ?? "", r2BucketName: value.r2BucketName ?? "" }));
    }).catch(() => { if (!controller.signal.aborted) setMessage("无法读取监控设置。"); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setLocal(null);
    void Promise.allSettled([
      getMonitorSummary(period, controller.signal, tick > 0),
      getCloudflareMetrics(period, controller.signal),
    ]).then(([localResult, cloudResult]) => {
      if (controller.signal.aborted) return;
      if (localResult.status === "fulfilled") setLocal(localResult.value);
      else setLocal(null);
      if (cloudResult.status === "fulfilled") setMetrics(cloudResult.value);
      else {
        setMetrics(null);
        setError(cloudResult.reason instanceof Error ? cloudResult.reason.message : "Cloudflare Analytics API 暂不可用。");
      }
      setLoading(false);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "读取资源数据失败。");
      setLoading(false);
    });
    return () => controller.abort();
  }, [period, tick, refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((value) => value + 1);
    }, preferences.refreshIntervalMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [preferences.refreshIntervalMinutes]);

  async function updateInterval(value: string) {
    const next = { ...preferences, refreshIntervalMinutes: Number(value) };
    try { await saveMonitorPreferences(next); setPreferences(next); setDraftPreferences(next); setMessage(`自动刷新已设为每 ${next.refreshIntervalMinutes} 分钟。`); }
    catch { setMessage("保存刷新频率失败。"); }
  }

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      await saveCloudflareConnection(setup);
      const controller = new AbortController();
      setConnection(await getCloudflareConnection(controller.signal));
      setSetup((current) => ({ ...current, apiToken: "" }));
      setMessage("Cloudflare Analytics 连接验证成功并已安全保存。");
      setTick((value) => value + 1);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "连接验证失败。"); }
    finally { setSaving(false); }
  }

  async function removeConnection() {
    try {
      await deleteCloudflareConnection();
      setConnection({ configured: false, accountId: null, scriptName: null, d1DatabaseId: null, r2BucketName: null });
      setMetrics(null);
      setSavedToken("");
      setShowSavedToken(false);
      setSetup({ ...EMPTY_SETUP });
      setMessage("Cloudflare API Token 已移除。");
    } catch { setMessage("移除 Cloudflare 连接失败。"); }
  }

  async function revealSavedToken() {
    if (showSavedToken) { setShowSavedToken(false); return; }
    try {
      const controller = new AbortController();
      setSavedToken(await getSavedCloudflareToken(controller.signal));
      setShowSavedToken(true);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "读取 Token 失败。"); }
  }

  async function copySavedToken() {
    try { await navigator.clipboard.writeText(savedToken); setMessage("Token 已复制。"); }
    catch { setMessage("复制失败，请检查浏览器剪贴板权限。"); }
  }

  async function saveThresholds() {
    if (!validPreferences(draftPreferences)) { setPreferencesMessage("参考额度需为正整数，阈值需递增且不超过 100%。"); return; }
    try { await saveMonitorPreferences(draftPreferences); setPreferences(draftPreferences); setPreferencesMessage("已保存到此浏览器。"); }
    catch { setPreferencesMessage("保存监控阈值失败。"); }
  }

  const requestPercent = period !== "utc_day" || local?.estimatedRequests === null || local?.estimatedRequests === undefined ? null : Math.min(100, local.estimatedRequests / preferences.dailyQuota * 100);
  const riskLabel = requestPercent === null ? "暂无评估" : requestPercent >= preferences.critical ? "高风险" : requestPercent >= preferences.warning ? "警告" : requestPercent >= preferences.reminder ? "提醒" : "正常";
  const updateThreshold = (key: "dailyQuota" | "reminder" | "warning" | "critical", value: string) => setDraftPreferences((old) => ({ ...old, [key]: Number(value) }));

  return <div className="mn-monitor">
    <div className="mn-monitor-toolbar">
      <label>周期
        <select value={period} onChange={(event) => setPeriod(event.target.value as MonitorSummary["period"])}>
          <option value="utc_day">今日（UTC）</option><option value="utc_month">本月（UTC）</option>
        </select>
      </label>
      <label>自动刷新
        <select value={preferences.refreshIntervalMinutes} onChange={(event) => void updateInterval(event.target.value)}>
          <option value={5}>每 5 分钟</option><option value={15}>每 15 分钟</option><option value={30}>每 30 分钟</option><option value={60}>每 60 分钟</option>
        </select>
      </label>
      <button type="button" className="app-button mn-refresh-button" onClick={() => setTick((value) => value + 1)} disabled={loading}>
        <RefreshCw aria-hidden="true" />{loading ? "刷新中" : "立即刷新"}
      </button>
    </div>
    <p className="mn-monitor-caption">官方指标按当前项目的 Worker、D1 数据库和 R2 桶筛选；Cloudflare 汇总有延迟，不等同账单。</p>
    {error && <p className="mn-monitor-error" role="alert">{error}</p>}
    {loading && <p className="mn-monitor-empty" role="status">正在读取 Cloudflare 资源数据…</p>}
    {!loading && !connection?.configured && <p className="mn-monitor-empty">连接只读 Analytics Token 后显示官方用量。应用内部抽样统计仍可独立查看。</p>}
    {metrics && <>
      <div className="mn-monitor-grid">
        <MetricCard title="Workers" source="Cloudflare 官方统计" rows={[
          ["请求", metrics.worker.requests.toLocaleString()], ["错误", metrics.worker.errors.toLocaleString()],
          ["CPU P50 / P99", `${formatMs(metrics.worker.cpuTimeP50)} / ${formatMs(metrics.worker.cpuTimeP99)}`],
        ]} />
        <MetricCard title="D1" source={connection?.d1DatabaseId ? "指定数据库" : "未配置数据库 ID"} rows={metrics.d1 ? [
          ["数据库大小", formatBytes(metrics.d1.sizeBytes)], ["读取行", metrics.d1.rowsRead.toLocaleString()], ["写入行", metrics.d1.rowsWritten.toLocaleString()],
        ] : [["用量", "在连接设置中填写 D1 Database ID"]]} />
        <MetricCard title="R2" source={connection?.r2BucketName ? "指定存储桶" : "未配置存储桶名"} rows={metrics.r2 ? [
          ["对象存储", formatBytes(metrics.r2.payloadBytes)], ["对象数", metrics.r2.objectCount.toLocaleString()], ["元数据", formatBytes(metrics.r2.metadataBytes)], ["读写操作", metrics.r2.operations.toLocaleString()],
        ] : [["用量", "在连接设置中填写 R2 Bucket 名称"]]} />
      </div>
      <p className="mn-monitor-updated">最近更新时间：{new Date(metrics.sampledAt).toLocaleString()}</p>
    </>}

    <section className="mn-monitor-section" aria-labelledby="mn-project-heading">
      <h2 id="mn-project-heading">应用内部统计</h2>
      <p className="mn-monitor-caption">请求数由应用自身 1% 抽样估算，和上方 Cloudflare 官方统计分开显示。</p>
      <div className="mn-monitor-project">
        <strong>{local?.estimatedRequests == null ? "暂无可用样本" : `约 ${local.estimatedRequests.toLocaleString()} 次请求`}</strong>
        <span>{local?.sampleCount ?? 0} 个样本 · {local?.sampledAt ? `最后采样 ${new Date(local.sampledAt).toLocaleString()}` : "尚无采样时间"}</span>
        {requestPercent !== null && <span>{riskLabel} · 相对本机参考值约 {requestPercent.toFixed(1)}%（{preferences.dailyQuota.toLocaleString()} 次/日）</span>}
      </div>
      <details className="mn-monitor-preferences">
        <summary>应用内估算额度与提醒阈值</summary>
        <p className="mn-monitor-caption">仅用于本机抽样估算提醒，不代表 Cloudflare 账户配额或收费上限。</p>
        <div className="mn-monitor-form">
          <label>每日参考请求数<input type="number" min="1" step="1" value={draftPreferences.dailyQuota} onChange={(event) => updateThreshold("dailyQuota", event.target.value)} /></label>
          <label>提醒阈值 %<input type="number" min="1" max="100" value={draftPreferences.reminder} onChange={(event) => updateThreshold("reminder", event.target.value)} /></label>
          <label>警告阈值 %<input type="number" min="1" max="100" value={draftPreferences.warning} onChange={(event) => updateThreshold("warning", event.target.value)} /></label>
          <label>高风险阈值 %<input type="number" min="1" max="100" value={draftPreferences.critical} onChange={(event) => updateThreshold("critical", event.target.value)} /></label>
        </div>
        <button type="button" className="app-button" onClick={() => void saveThresholds()}>保存提醒设置</button>
        <p className="mn-monitor-message" role="status">{preferencesMessage}</p>
      </details>
    </section>

    <details className="mn-monitor-setup">
      <summary>{connection?.configured ? "Cloudflare API 连接设置" : "连接 Cloudflare Analytics API"}</summary>
      <p className="mn-monitor-caption">需要只读 Account Analytics Read Token。Token 由服务端使用 AUTH_PEPPER 加密保存；不会发回浏览器。</p>
      {connection?.configured && <p className="mn-monitor-caption">当前账户 {connection.accountId} · Worker {connection.scriptName}。更新凭据时请重新输入 Token。</p>}
      {connection?.configured && <div className="mn-monitor-actions">
        <button type="button" className="mn-statuslink" onClick={() => void revealSavedToken()}>{showSavedToken ? "隐藏已保存 Token" : "查看已保存 Token"}</button>
        {showSavedToken && <><code className="mn-monitor-token">{savedToken}</code><button type="button" className="mn-statuslink" onClick={() => void copySavedToken()}>复制</button></>}
      </div>}
      <form className="mn-monitor-form" onSubmit={(event) => void saveConnection(event)}>
        <label>Cloudflare Account ID<input value={setup.accountId} onChange={(event) => setSetup({ ...setup, accountId: event.target.value.trim() })} required maxLength={32} /></label>
        <label>只读 API Token<input type="password" autoComplete="new-password" value={setup.apiToken} onChange={(event) => setSetup({ ...setup, apiToken: event.target.value })} required maxLength={512} /></label>
        <label>Worker 名称<input value={setup.scriptName} onChange={(event) => setSetup({ ...setup, scriptName: event.target.value.trim() })} required maxLength={64} /></label>
        <label>D1 Database ID（可选）<input value={setup.d1DatabaseId} onChange={(event) => setSetup({ ...setup, d1DatabaseId: event.target.value.trim() })} maxLength={36} placeholder="Cloudflare D1 数据库详情页" /></label>
        <label>R2 Bucket 名称（可选）<input value={setup.r2BucketName} onChange={(event) => setSetup({ ...setup, r2BucketName: event.target.value.trim() })} maxLength={64} placeholder="桶名；限制区域时填写 eu_桶名" /></label>
        <div className="mn-monitor-actions">
          <button className="app-button" type="submit" disabled={saving}>{saving ? "验证中…" : "验证并保存"}</button>
          {connection?.configured && <button className="mn-statuslink" type="button" onClick={() => void removeConnection()}>移除连接</button>}
        </div>
      </form>
      <p className="mn-monitor-message" role="status">{message}</p>
    </details>
  </div>;
}

function MetricCard({ title, source, rows }: { title: string; source: string; rows: Array<[string, string]> }) {
  return <section className="mn-monitor-card">
    <div className="mn-monitor-card-head"><h2>{title}</h2><span>{source}</span></div>
    <dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(2)} ${units[index]}`;
}

function formatMs(value: number | null): string { return value === null ? "—" : `${value.toLocaleString()} μs`; }
