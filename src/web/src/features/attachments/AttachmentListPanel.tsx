import { useCallback, useEffect, useState } from "react";
import type { Attachment } from "@menote/shared";
import { attachmentUrl, listAttachmentReferences, listAttachments, type AttachmentDetails } from "../../services/attachmentService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";

interface AttachmentListPanelProps { userId: string }
type AttachmentView = "list" | "gallery";
function formatSize(size: number): string {
  if (size >= 1_048_576) return `${(size / 1_048_576).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
}

/** 附件管理：显示文件名、缩略图与引用文章。 */
export function AttachmentListPanel({ userId }: AttachmentListPanelProps) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(() => peek<Attachment[]>(SETTINGS_CACHE.attachments(userId)) ?? null);
  const [references, setReferences] = useState<Record<string, AttachmentDetails>>(() => peek<Record<string, AttachmentDetails>>(SETTINGS_CACHE.attachmentRefs(userId)) ?? {});
  const [error, setError] = useState(false);
  const [view, setView] = useState<AttachmentView>("list");

  const refresh = useCallback(async (fresh = false) => {
    try {
      const [rows, refs] = await Promise.all([
        loadShared(SETTINGS_CACHE.attachments(userId), () => listAttachments(userId), fresh),
        loadShared(SETTINGS_CACHE.attachmentRefs(userId), () => listAttachmentReferences(userId), fresh),
      ]);
      setAttachments(rows);
      setReferences(refs);
      setError(false);
    } catch { setError(true); }
  }, [userId]);
  useEffect(() => { void refresh(); }, [refresh]);
  const orphaned = (attachments ?? []).filter((item) => item.refCount === 0);

  return (
    <section className="status-panel" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">附件管理</h2>
      <p className="app-description">查看附件及引用文章。为保护数据，附件自动清理和手动删除暂不可用。</p>
      <div className="mn-attach-toolbar">
        <button type="button" className="mn-textbtn" disabled>一键清理未引用资源（暂不可用）</button>
        <div className="mn-attach-view" role="group" aria-label="附件显示方式">
          <button type="button" aria-pressed={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>列表</button>
          <button type="button" aria-pressed={view === "gallery"} className={view === "gallery" ? "on" : ""} onClick={() => setView("gallery")}>图册</button>
        </div>
      </div>
      {attachments !== null && <div className="mn-attach-overview" aria-label="附件统计"><span>共 {attachments.length} 个附件</span><span>未引用 {orphaned.length} 个</span></div>}
      {error && <p className="status-detail">附件列表暂不可用。</p>}
      {!error && attachments === null && <p className="status-detail">加载中…</p>}
      {attachments !== null && attachments.length === 0 && <p className="status-detail">暂无附件。</p>}
      {view === "gallery" && attachments?.some((attachment) => attachment.mime.startsWith("image/")) && <div className="mn-attach-gallery" aria-label="图片附件图册">
        {attachments.filter((attachment) => attachment.mime.startsWith("image/")).map((attachment) => {
          const detail = references[attachment.sha256];
          const name = detail?.name ?? `${attachment.sha256.slice(0, 12)}…`;
          return <a key={attachment.sha256} className="mn-attach-gallery-item" href={attachmentUrl(attachment.sha256)} target="_blank" rel="noreferrer" aria-label={`查看图片 ${name}`}>
            <img src={attachmentUrl(attachment.sha256)} alt={name} loading="lazy" />
            <span>{name}</span>
          </a>;
        })}
      </div>}
      {view === "gallery" && attachments && !attachments.some((attachment) => attachment.mime.startsWith("image/")) && <p className="status-detail">暂无图片附件；其他文件可在列表模式查看。</p>}
      {view === "list" && attachments !== null && attachments.length > 0 && (
        <ul className="mn-attachlist" aria-label="附件列表">
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
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
