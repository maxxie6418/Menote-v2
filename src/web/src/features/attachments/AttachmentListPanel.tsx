import { useCallback, useEffect, useState } from "react";
import type { Attachment } from "@menote/shared";
import { deleteAttachment, listAttachments } from "../../services/attachmentService";

interface AttachmentListPanelProps {
  userId: string;
}

function formatSize(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}

/** 附件管理（FR-SYNC-8 前半）：可见全部附件与引用计数；删除仅限零引用（30 天真删在 G10）。 */
export function AttachmentListPanel({ userId }: AttachmentListPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    listAttachments(userId).then((rows) => setAttachments(rows)).catch(() => setError(true));
  }, [userId]);

  useEffect(() => { refresh(); }, [refresh]);

  const remove = async (sha256: string) => {
    if (await deleteAttachment(sha256)) refresh();
  };

  return (
    <section className="status-panel" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">附件管理</h2>
      <p className="app-description">正文引用的附件在此汇总；删除引用 30 天后自动清理（FR-SYNC-8）。</p>
      {error && <p className="status-detail">附件列表暂不可用。</p>}
      {!error && attachments === null && <p className="status-detail">加载中…</p>}
      {attachments !== null && attachments.length === 0 && <p className="status-detail">暂无附件。</p>}
      {attachments !== null && attachments.length > 0 && (
        <ul className="mn-attachlist">
          {attachments.map((attachment) => (
            <li key={attachment.sha256} className="mn-attachrow">
              <a href={`/api/attachments/${attachment.sha256}`} target="_blank" rel="noreferrer">
                {attachment.sha256.slice(0, 12)}…
              </a>
              <span className="mn-attachmeta">{attachment.mime} · {formatSize(attachment.size)} · 引用 {attachment.refCount}</span>
              {attachment.refCount === 0 && (
                <button type="button" className="mn-minibtn" aria-label="删除未引用附件" onClick={() => void remove(attachment.sha256)}>
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
