import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "../../icons";
import { subscribeLocalChanges } from "../../lib/broadcast";
import { lastSyncCycleSummary, subscribeSyncDiagnostics } from "../../services/syncDiagnosticsService";
import { getDeviceId, getSyncPhase, getSyncProgress, requestSyncNow, subscribeSyncStatus, syncQueueStatus, type SyncPhase, type SyncProgress } from "../../services/syncEngine";
import { SettingsGroup } from "./SettingsGroup";

/** 同步设置页：在侧栏状态之外补齐必要信息——上次同步时间、队列明细、失败原因、设备与自动同步机制。
 *  数据口径：队列与设备号来自 syncEngine；上次同步与最近错误来自本机诊断日志（syncDiagnosticsService）。 */
export function SyncSection({ userId, onOpenLogs }: { userId: string; onOpenLogs: () => void }) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [progress, setProgress] = useState<SyncProgress>(getSyncProgress);
  const [queue, setQueue] = useState({ pending: 0, failed: 0 });
  const [summary, setSummary] = useState<{ completedAt: number | null; lastError: { at: number; code: string } | null } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const refresh = () => setOnline(navigator.onLine);
    window.addEventListener("online", refresh);
    window.addEventListener("offline", refresh);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("offline", refresh);
    };
  }, []);
  useEffect(() => subscribeSyncStatus(() => { setPhase(getSyncPhase()); setProgress(getSyncProgress()); }), []);
  const loadQueue = useCallback(() => { void syncQueueStatus(userId).then(setQueue); }, [userId]);
  const loadSummary = useCallback(() => { void lastSyncCycleSummary(userId).then(setSummary); }, [userId]);
  useEffect(() => {
    loadQueue();
    return subscribeLocalChanges(loadQueue);
  }, [loadQueue]);
  useEffect(() => {
    loadSummary();
    void getDeviceId().then((id) => setDeviceId(id));
    return subscribeSyncDiagnostics(loadSummary);
  }, [loadSummary]);
  const statusText = !online ? "当前离线，改动保存在本机" : phase === "syncing"
    ? (progress.stage === "push" && progress.total > 0 ? `正在上传 ${progress.completed}/${progress.total}` : progress.stage === "pull" ? "正在拉取更新…" : "同步中…")
    : phase === "error" ? "同步异常" : queue.failed > 0 ? `同步异常 · ${queue.failed} 项失败` : queue.pending > 0 ? `已保存，${queue.pending} 项待上传` : summary?.completedAt ? "已同步" : "等待首轮同步";
  const errorText = summary?.lastError
    ? `${new Date(summary.lastError.at).toLocaleString()} · ${summary.lastError.code}`
    : "最近没有记录到错误";
  const syncNow = async () => {
    setBusy(true);
    try { await requestSyncNow(userId); }
    finally { loadQueue(); loadSummary(); setBusy(false); }
  };
  return (
    <div className="mn-settings-stack">
      <section className="mn-settings-card mn-settings-status" aria-label="同步状态">
        <div className="mn-settings-heading">
          <div><h3>当前状态</h3><p className="mn-settings-state" data-error={phase === "error" || queue.failed > 0} role="status">{statusText}</p></div>
          <button type="button" className="mn-textbtn mn-settings-primary" disabled={!online || busy || phase === "syncing"} onClick={() => void syncNow()}>
            <RefreshCw />{busy ? "同步中…" : "立即同步"}
          </button>
        </div>
        <dl className="mn-settings-metrics">
          <div><dt>待上传</dt><dd>{queue.pending} 项</dd></div>
          <div><dt>失败</dt><dd>{queue.failed} 项</dd></div>
          <div><dt>上次同步完成</dt><dd>{summary === null ? "读取中…" : summary.completedAt ? new Date(summary.completedAt).toLocaleString() : "等待首轮同步"}</dd></div>
        </dl>
        {(phase === "error" || queue.failed > 0) && <p className="mn-settings-notice is-error">{errorText}</p>}
        <div className="mn-set-actions"><button type="button" className="mn-textbtn mn-settings-outline" onClick={onOpenLogs}>查看诊断日志</button></div>
      </section>
      <SettingsGroup title="自动同步">
        <div className="mn-setrow">
          <div><p className="mn-setlabel">同步时机</p><p className="mn-sethint">本地保存后排队上传。恢复联网或回到前台时会继续同步。</p></div>
          <span className="mn-settings-value">后台每 5 分钟检查</span>
        </div>
        <div className="mn-setrow">
          <div><p className="mn-setlabel">本设备标识</p><p className="mn-sethint">用于辨认同步日志中的设备。</p></div>
          <code className="mn-syncvalue">{deviceId ? deviceId.slice(0, 12) : "读取中…"}</code>
        </div>
      </SettingsGroup>
    </div>
  );
}
