import { useEffect, useState, useSyncExternalStore } from "react";
import { RefreshCw } from "../../icons";
import { getSyncPhase, getSyncProgress, requestSyncNow, subscribeSyncStatus, type SyncPhase, type SyncProgress } from "../../services/syncEngine";
import { useSyncQueueStatus } from "../../services/contentHooks";
import { getEditorRevision, subscribeEditorChanges } from "../../services/editorSaveService";

export function SidebarSyncControl({ userId, collapsed }: { userId: string; collapsed: boolean }) {
  const [phase, setPhase] = useState<SyncPhase>(getSyncPhase);
  const [progress, setProgress] = useState<SyncProgress>(getSyncProgress);
  const queue = useSyncQueueStatus(userId);
  const editorRevision = useSyncExternalStore(subscribeEditorChanges, getEditorRevision);
  const [manualResult, setManualResult] = useState<{ success: boolean; revision: number } | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [manualBusy, setManualBusy] = useState(false);
  useEffect(() => subscribeSyncStatus(() => { setPhase(getSyncPhase()); setProgress(getSyncProgress()); }), []);
  useEffect(() => { if (queue.pending > 0) setManualResult(null); }, [queue.pending]);
  useEffect(() => { setManualResult(null); }, [userId]);
  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);
  const result = manualResult?.revision === editorRevision ? manualResult : null;
  const syncingLabel = progress.stage === "push" && progress.total > 0
    ? `正在上传 ${progress.completed}/${progress.total}`
    : progress.stage === "pull" ? "正在拉取更新…" : "同步中…";
  const label = !online ? "离线，等待联网" : phase === "syncing" ? syncingLabel : manualBusy ? "正在上传…" : result && !result.success ? "上传失败，请重试" : phase === "error" ? "同步异常" : queue.failed ? `同步异常 · ${queue.failed} 项失败` : queue.pending ? `${queue.pending} 项待上传` : result?.success ? "已全部上传" : "已同步";
  const state = !online ? "offline" : phase === "syncing" || manualBusy ? "pending" : (result && !result.success) || phase === "error" || queue.failed ? "error" : queue.pending ? "pending" : "idle";
  const action = !online ? "联网后可立即同步" : manualBusy ? "正在同步" : phase === "syncing" ? "当前同步结束后立即再同步" : "立即同步";
  const uploadNow = async () => {
    setManualBusy(true);
    setManualResult(null);
    try {
      const success = await requestSyncNow(userId);
      setManualResult({ success, revision: getEditorRevision() });
    } catch {
      setManualResult({ success: false, revision: getEditorRevision() });
    } finally {
      setManualBusy(false);
    }
  };
  return <div className={`mn-sidebar-sync is-${state}${collapsed ? " is-collapsed" : ""}`}>
    <button type="button" className="mn-sidebar-sync-button" disabled={manualBusy || !online}
      aria-label={`${label} · ${action}`} title={`${label} · ${action}`}
      onClick={() => { void uploadNow(); }}>
      <span className="mn-sidebar-sync-dot" aria-hidden="true" />
      {!collapsed && <span className="mn-sidebar-sync-state" role="status">{label}</span>}
      <RefreshCw aria-hidden="true" />
    </button>
    {phase === "syncing" && !collapsed && <progress className="mn-sidebar-sync-progress"
        value={progress.stage === "push" && progress.total > 0 ? progress.completed : undefined}
        max={progress.stage === "push" && progress.total > 0 ? progress.total : undefined}
        aria-label={progress.stage === "pull" ? "正在拉取更新" : "正在推送变更"} />}
  </div>;
}
