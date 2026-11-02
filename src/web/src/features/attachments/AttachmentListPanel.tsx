import { useCallback, useEffect, useMemo, useState } from "react";
import type { Attachment } from "@menote/shared";
import { attachmentUrl, deleteAttachment, listAttachmentReferences, listAttachments, type AttachmentDetails } from "../../services/attachmentService";

interface AttachmentListPanelProps { userId: string }
function formatSize(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}

/** 附件管理：显示文件名、缩略图与引用文章；删除由服务端再次校验零引用。 */
export function AttachmentListPanel({ userId }: AttachmentListPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [references, setReferences] = useState<Record<string, AttachmentDetails>>({});
  const [error, setError] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [rows, refs] = await Promise.all([listAttachments(userId), listAttachmentReferences(userId)]);
      setAttachments(rows);
      setReferences(refs);
      setError(false);
    } catch { setError(true); }
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const orphaned = useMemo(() => (attachments ?? []).filter((item) => item.refCount === 0), [attachments]);
  const clean = async () => {
    if (cleaning || orphaned.length === 0) return;
    setCleaning(true);
    setMessage("");
    let removed = 0;
    for (const attachment of orphaned) if (await deleteAttachment(attachment.sha256)) removed += 1;
    await refresh();
    setMessage(`已清理 ${removed} 个未引用附件。`);
    setCleaning(false);
  };
  const remove = async (sha256: string) => {
    if (await deleteAttachment(sha256)) await refresh();
  };

  return (
    <section className="status-panel" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">附件管理</h2>
      <p className="app-description">查看附件及引用文章；删除引用 30 天后自动清理（FR-SYNC-8）。</p>
      {error && <p className="status-detail">附件列表暂不可用。</p>}
      {!error && attachments === null && <p className="status-detail">加载中…</p>}
      {attachments !== null && attachments.length === 0 && <p className="status-detail">暂无附件。</p>}
      {attachments !== null && attachments.length > 0 && (
        <ul className="mn-attachlist">
          {attachments.map((attachment) => {
            const detail = references[attachment.sha256];
            const name = detail?.name ?? `${attachment.sha256.slice(0, 12)}…`;
            return (
              <li key={attachment.sha256} className="mn-attachrow">
                {attachment.mime.startsWith("image/")
                  ? <a className="mn-attachthumb" href={attachmentUrl(attachment.sha256)} target="_blank" rel="noreferrer" aria-label={`查看附件 ${name}`}><img src={attachmentUrl(attachment.sha256)} alt={name} loading="lazy" /></a>
                  : <span className="mn-attachthumb mn-attachthumb-file" aria-hidden="true">文件</span>}
                <div className="mn-attachcontent">
                  <a className="mn-attachname" href={attachmentUrl(attachment.sha256)} target="_blank" rel="noreferrer">{name}</a>
                  <span className="mn-attachmeta">{attachment.mime} · {formatSize(attachment.size)} · 引用 {attachment.refCount}</span>
                  {detail?.references.length ? <div className="mn-attachrefs">引用文章：{detail.references.map((ref, index) => <span key={ref.id}>{index > 0 && "、"}<a href={ref.href}>{ref.title}</a></span>)}</div> : <span className="mn-attachmeta">暂无引用文章</span>}
                </div>
                {attachment.refCount === 0 && <button type="button" className="mn-textbtn" aria-label="删除未引用附件" onClick={() => void remove(attachment.sha256)}>删除</button>}
              </li>
            );
          })}
        </ul>
      )}
      {attachments !== null && attachments.length === 0 && <div className="mn-attach-clean"><button type="button" className="mn-textbtn" disabled>一键清理未引用资源</button></div>}
      {message && <p className="status-detail" role="status">{message}</p>}
      <div className="mn-attach-clean"><button type="button" className="mn-textbtn" disabled={cleaning || orphaned.length === 0} onClick={() => void clean()}>{cleaning ? "清理中…" : `一键清理未引用资源${orphaned.length ? `（${orphaned.length}）` : ""}`}</button></div>
    </section>
  );
}
