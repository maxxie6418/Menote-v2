import { useEffect, useState } from "react";
import type { AccountArchiveSummary } from "@menote/shared";
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import { accountArchiveAvailable, uploadAccountArchive } from "../../services/backupService";
import { requestSyncNow } from "../../services/syncEngine";

export function ArchiveRestorePanel({ userId }: { userId: string }) {
  const [available, setAvailable] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AccountArchiveSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void accountArchiveAvailable().then(value => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, []);

  async function submit(restore: boolean) {
    if (!file || busy) return;
    if (restore && !await confirmDialog({ title: "恢复迁移包", message: "将已校验的快照合并到当前账号。同一条目会按版本合并，已有的新版本会保留。继续恢复？" })) return;
    setBusy(true);
    setMessage(restore ? "正在校验并恢复数据…" : "正在上传并校验文件…");
    try {
      const result = await uploadAccountArchive(file, restore);
      if (restore) {
        setPreview(null);
        setMessage(`已恢复 ${result.items} 条内容、${result.topics} 个主题或分组、${result.attachments} 个附件，跳过 ${result.skipped} 项。`);
        const synced = await requestSyncNow(userId).catch(() => false);
        if (!synced) setMessage(previous => previous + " 服务器恢复完成，请稍后同步本机。");
      } else {
        setPreview(result);
        setMessage(`校验通过：${result.items} 条内容、${result.topics} 个主题或分组、${result.attachments} 个附件、${result.templates} 个剪藏模板、${result.raindropRows} 条 Raindrop 映射。`);
      }
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : "迁移包处理失败，请重试。");
    } finally { setBusy(false); }
  }
  if (!available) return null;
  return <section aria-labelledby="account-archive-heading">
    <h3 id="account-archive-heading">从迁移包恢复</h3>
    <div className="mn-backupactions">
      <input type="file" aria-label="选择账号迁移包" accept=".zip,application/zip" disabled={busy} onChange={event => {
        setFile(event.target.files?.[0] ?? null); setPreview(null); setMessage("");
      }} />
      <button type="button" className="mn-textbtn" disabled={!file || busy} onClick={() => void submit(Boolean(preview))}>
        {preview ? "恢复到当前账号" : "上传并校验"}
      </button>
    </div>
    {message && <p className="status-detail" role="status">{message}</p>}
  </section>;
}
