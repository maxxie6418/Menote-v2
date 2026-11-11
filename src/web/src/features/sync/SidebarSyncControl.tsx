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
  const label = manualBusy ? "正在上传…" : !online ? "离线，等待联网" : result && !result.success ? "上传失败，请重试" : phase === "syncing" ? "同步中" : phase === "error" ? "同步异常" : queue.failed ? `同步异常 · ${queue.failed} 项失败` : queue.pending ? `${queue.pending} 项待上传` : result?.success ? "已全部上传" : "已同步";
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
  return <div className="mn-sidebar-sync">
    <button type="button" className="mn-sidebar-sync-button" disabled={manualBusy || !online}
      aria-label={phase === "syncing" ? "当前同步结束后立即再同步" : "立即同步"} title={phase === "syncing" ? "当前同步结束后立即再同步" : "立即同步"}
      onClick={() => { void uploadNow(); }}>
      <RefreshCw aria-hidden="true" />{!collapsed && <span>立即同步</span>}
    </button>
    {!collapsed && <span className="mn-sidebar-sync-state" role="status">{label}</span>}
    {phase === "syncing" && !collapsed && <progress className="mn-sidebar-sync-progress"
      value={progress.stage === "push" && progress.total > 0 ? progress.completed : undefined}
      max={progress.stage === "push" && progress.total > 0 ? progress.total : undefined}
      aria-label={progress.stage === "pull" ? "正在拉取更新" : "正在推送变更"} />}
  </div>;
}
