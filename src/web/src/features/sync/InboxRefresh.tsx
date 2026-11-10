import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { getSyncPhase, requestSyncNow } from "../../services/syncEngine";

/** 手动同步并拉取剪藏；同步完成后本地订阅会更新收件箱。 */
export function InboxRefresh({ userId, mobile = false }: { userId: string; mobile?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function refresh() {
    setBusy(true);
    setMessage("正在刷新收件箱");
    try {
      await requestSyncNow(userId);
      setMessage(getSyncPhase() === "error" ? "刷新失败，请检查网络和同步状态" : "收件箱已刷新");
    } catch {
      setMessage("刷新失败，请检查网络和同步状态");
    } finally { setBusy(false); }
  }
  return <>
    <button type="button" className={mobile ? "m-icon-btn" : "mn-iconbtn"} disabled={busy}
      aria-label={busy ? "正在刷新收件箱" : "刷新收件箱"} title={busy ? "正在刷新收件箱" : "刷新收件箱"}
      onClick={() => { void refresh(); }}><RefreshCw aria-hidden="true" /></button>
    <span className="mn-inbox-refresh-status" role="status">{message}</span>
  </>;
}
