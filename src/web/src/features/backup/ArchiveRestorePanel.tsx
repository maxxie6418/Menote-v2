import { useState } from "react";
import type { AccountArchiveSummary } from "@menote/shared";
import { Archive, Download, FolderInput } from "../../icons";
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import { downloadAccountPackage, uploadAccountArchive } from "../../services/backupService";
import { requestSyncNow } from "../../services/syncEngine";
import "../../styles/backup.css";

export function ArchiveRestorePanel({ userId }: { userId: string }) {
  const [importing, setImporting] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AccountArchiveSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function download() {
    if (busy) return;
    setBusy(true);
    setMessage("正在同步本机改动…");
    try {
      if (!await requestSyncNow(userId)) throw new Error("本机改动尚未确认同步，请检查同步状态后重试。");
      setMessage("正在打包笔记和附件…");
      await downloadAccountPackage();
      setMessage("备份包已生成，请查看浏览器下载记录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "下载失败，请重试。");
    } finally { setBusy(false); }
  }

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
  return <section className="bk-card bk-local" aria-labelledby="account-archive-heading">
    <div className="bk-name"><span className="bk-icon"><Archive /></span><h3 id="account-archive-heading">本地备份包</h3></div>
    <p className="bk-meta">下载当前账号的笔记和附件，或从备份、迁移 ZIP 恢复。</p>
    <div className="bk-actions">
      <button type="button" className="mn-textbtn bk-outline" disabled={busy} onClick={() => void download()}><Download />下载备份包 ZIP</button>
      <button type="button" className="mn-textbtn" aria-expanded={importing} disabled={busy} onClick={() => setImporting(!importing)}><FolderInput />从 ZIP 恢复</button>
    </div>
    <div className="bk-import" hidden={!importing}>
      <p className="bk-meta">选择 ZIP 后先校验。加密内容需要原隐私密码或恢复码解锁。</p>
      <div className="bk-actions">
        <input type="file" className="bk-file" aria-label="选择备份或迁移 ZIP" accept=".zip,application/zip" disabled={busy} onChange={event => {
          setFile(event.target.files?.[0] ?? null); setPreview(null); setMessage("");
        }} />
        <button type="button" className="mn-textbtn bk-outline" disabled={!file || busy} onClick={() => void submit(Boolean(preview))}>
          {preview ? "恢复到当前账号" : "上传并校验"}
        </button>
      </div>
    </div>
    {message && <p className="bk-notice" role="status">{message}</p>}
  </section>;
}
