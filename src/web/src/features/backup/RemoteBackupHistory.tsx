import { useEffect, useState } from "react";
import type { RemoteBackup } from "@menote/shared";
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import { ChevronDown } from "../../icons";
import { deleteRemoteBackup, listRemoteBackups, restoreRemoteBackup, verifyRemoteBackup, type TargetView } from "../../services/backupService";
import { requestSyncNow } from "../../services/syncEngine";

const PAGE_SIZE = 5;
const dateFormat = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
function snapshotTime(backup: RemoteBackup) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-/i.exec(backup.id);
  const stamp = match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z` : backup.lastModified;
  const time = stamp ? Date.parse(stamp) : NaN;
  return Number.isFinite(time) ? dateFormat.format(time) : backup.id;
}

export function RemoteBackupHistory({ userId, target, revision }: { userId: string; target: TargetView; revision: number }) {
  const [backups, setBackups] = useState<RemoteBackup[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [count, setCount] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let current = true;
    setBackups(null); setError("");
    void listRemoteBackups(target.id).then(result => {
      if (!current) return;
      setError(result.error ?? ""); setBackups(result.backups);
    });
    return () => { current = false; };
  }, [target.id, revision, retry]);

  async function act(backup: RemoteBackup, action: "verify" | "restore" | "delete") {
    const id = backup.id;
    if (action === "delete" && !await confirmDialog({ title: "删除远端备份", message: `永久删除 ${target.remotePath}/${id}/？此操作无法撤销，本地数据会保留。`, danger: true })) return;
    if (action === "restore" && !await confirmDialog({ title: "恢复备份", message: `从 ${id} 合并恢复到当前账号？较新的现有条目会保留，旧数据可能被恢复版本覆盖。建议先推送一份新备份。` })) return;
    setBusy(true);
    try {
      if (action === "delete") {
        setMessage("正在删除远端备份…");
        const result = await deleteRemoteBackup(target.id, id);
        if (result.ok) setBackups(previous => previous?.filter(row => row.id !== id) ?? null);
        setMessage(result.ok ? "已删除这份远端备份。" : `删除失败：${result.error ?? "未知错误"}`);
      } else if (action === "verify") {
        setMessage("正在校验快照文件…");
        const result = await verifyRemoteBackup(target.id, id);
        setMessage(result.ok ? `文件校验通过，共 ${result.shards} 个数据分片、${result.attachments} 个附件。` : `校验失败：${result.error ?? "未知错误"}`);
      } else {
        setMessage("正在校验并恢复快照…");
        const result = await restoreRemoteBackup(target.id, id);
        if (!result.ok) { setMessage(`恢复失败：${result.error ?? "未知错误"}`); return; }
        const synced = await requestSyncNow(userId).catch(() => false);
        setMessage(`已恢复 ${result.items} 条内容、${result.topics} 个主题、${result.attachments ?? 0} 个附件，跳过 ${result.skipped} 项。${synced ? "" : "请稍后同步本机。"}`);
      }
    } finally { setBusy(false); }
  }

  return <div className="bk-history">
    {message && <p role="status" className="bk-notice">{message}</p>}
    {error ? <div role="status" className="bk-notice">读取目录失败：{error} <button type="button" className="mn-textbtn" onClick={() => setRetry(n => n + 1)}>重试</button></div>
      : backups === null ? <p role="status" className="bk-meta">正在读取备份记录…</p>
      : backups.length === 0 ? <p className="bk-meta">此位置尚无备份记录。</p>
      : <>
        <div className="bk-history-head"><span>{target.remotePath}/</span><span>共 {backups.length} 份</span></div>
        {backups.slice(0, count).map(backup => <details className="bk-snapshot" key={backup.id}>
          <summary>
            <span className="bk-time">{snapshotTime(backup)}</span>
            <span className="bk-state" data-complete={backup.complete}>{backup.complete ? "已完成" : "未完成"}</span>
            <ChevronDown className="bk-chevron" />
          </summary>
          <div className="bk-snapshot-detail">
            <code className="bk-code">{target.remotePath}/{backup.id}/</code>
            {!backup.complete && <p className="bk-meta">缺少 COMPLETE 标记，无法校验或恢复。</p>}
            <div className="bk-actions">
              {backup.complete && <>
                <button type="button" className="mn-textbtn bk-outline" disabled={busy} onClick={() => void act(backup, "verify")}>校验备份</button>
                <button type="button" className="mn-textbtn bk-outline" disabled={busy} onClick={() => void act(backup, "restore")}>恢复到当前账号</button>
              </>}
              <button type="button" className="mn-textbtn bk-danger" disabled={busy} onClick={() => void act(backup, "delete")}>删除这份备份</button>
            </div>
          </div>
        </details>)}
        {count < backups.length && <button type="button" className="mn-textbtn bk-more" onClick={() => setCount(count + PAGE_SIZE)}>显示更多（剩余 {backups.length - count} 份）</button>}
      </>}
  </div>;
}
