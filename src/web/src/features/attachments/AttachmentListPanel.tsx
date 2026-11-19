import { useCallback, useEffect, useState } from "react";
import { SEALED_ATTACHMENT_MIME, type AttachmentPage } from "@menote/shared";
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import {
  attachmentUrl, deleteAttachment, listAttachmentReferences, listAttachments, locallyReferencedAttachmentHashes, type AttachmentDetails,
} from "../../services/attachmentService";
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
  const [page, setPage] = useState<AttachmentPage | null>(() => peek<AttachmentPage>(SETTINGS_CACHE.attachments(userId)) ?? null);
  const [cursors, setCursors] = useState([""]);
  const [references, setReferences] = useState<Record<string, AttachmentDetails>>(() => peek<Record<string, AttachmentDetails>>(SETTINGS_CACHE.attachmentRefs(userId)) ?? {});
  const [error, setError] = useState(false);
  const [view, setView] = useState<AttachmentView>("list");
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const cursor = cursors.at(-1) ?? "";
  const attachments = page?.attachments ?? null;

  const refresh = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const refsKey = SETTINGS_CACHE.attachmentRefs(userId);
      const [rows, refs] = await Promise.all([
        loadShared(SETTINGS_CACHE.attachments(userId, cursor), () => listAttachments(cursor), fresh),
        (!fresh && cursor ? peek<Record<string, AttachmentDetails>>(refsKey) : undefined)
          ?? loadShared(refsKey, () => listAttachmentReferences(userId), fresh),
      ]);
      setPage(rows);
      setReferences(refs);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [userId, cursor]);
  useEffect(() => { void refresh(); }, [refresh]);
  const orphaned = (attachments ?? []).filter((item) => item.refCount === 0);
  const eligible = new Set(orphaned.filter((item) => item.cleanupEligibleAt != null && item.cleanupEligibleAt <= Date.now())
    .map((item) => item.sha256));

  function navigate(nextCursors: string[]) {
    setLoading(true);
    setPage(null);
    setError(false);
    setCleanupMessage("");
    setCursors(nextCursors);
  }

  async function clean(hashes: readonly string[]) {
    setCleaning(true);
    setCleanupMessage("");
    try {
      if (!await confirmDialog({
        title: "永久清理附件",
        message: `将检查所选的 ${hashes.length} 个附件。仅清理连续 30 天没有笔记引用的对象，引用范围包括回收站。`,
        confirmLabel: "清理附件",
        danger: true,
      })) return;
      const referenced = await locallyReferencedAttachmentHashes(userId);
      const candidates = hashes.filter((hash) => !referenced.has(hash));
      let deleted = 0;
      let protectedCount = hashes.length - candidates.length;
      let failed = 0;
      for (let index = 0; index < candidates.length; index += 6) {
        const results = await Promise.all(candidates.slice(index, index + 6).map(deleteAttachment));
        for (const result of results) {
          if (result === "deleted") deleted++;
          else if (result === "protected") protectedCount++;
          else failed++;
        }
      }
      setCleanupMessage(`已清理 ${deleted} 个${protectedCount ? `，保留 ${protectedCount} 个` : ""}${failed ? `，有 ${failed} 个暂未清理` : ""}。`);
      await refresh(true);
    } catch {
      setCleanupMessage("附件清理暂不可用。");
    } finally {
      setCleaning(false);
    }
  }

  return (
    <section className="status-panel" aria-labelledby="attachments-heading">
      <h2 id="attachments-heading">附件管理</h2>
      <p className="app-description">附件在最后一条引用移除 30 天后可清理，回收站中的笔记仍计入引用。</p>
      <div className="mn-attach-toolbar">
        <button type="button" className="mn-textbtn" disabled={loading || cleaning || !eligible.size}
          onClick={() => void clean([...eligible])}>{cleaning ? "处理中…" : "清理本页到期附件"}</button>
        <div className="mn-attach-view" role="group" aria-label="附件显示方式">
          <button type="button" aria-pressed={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>列表</button>
          <button type="button" aria-pressed={view === "gallery"} className={view === "gallery" ? "on" : ""} onClick={() => setView("gallery")}>图册</button>
        </div>
      </div>
      {attachments !== null && <div className="mn-attach-overview" aria-label="附件统计"><span>本页 {attachments.length} 个附件</span><span>未引用 {orphaned.length} 个</span><span>可清理 {eligible.size} 个</span></div>}
      {(cursors.length > 1 || page?.nextCursor) && <nav className="mn-attach-toolbar" aria-label="附件分页">
        <button type="button" className="mn-textbtn" disabled={loading || cleaning || cursors.length <= 1}
          onClick={() => navigate(cursors.slice(0, -1))}>上一页</button>
        <span className="mn-attachmeta">第 {cursors.length} 页</span>
        <button type="button" className="mn-textbtn" disabled={loading || cleaning || !page?.nextCursor}
          onClick={() => { if (page?.nextCursor) navigate([...cursors, page.nextCursor]); }}>下一页</button>
      </nav>}
      {cleanupMessage && <p className="status-detail" role="status">{cleanupMessage}</p>}
      {error && <p className="status-detail">附件列表暂不可用。</p>}
      {!error && attachments === null && <p className="status-detail">加载中…</p>}
      {attachments !== null && attachments.length === 0 && <p className="status-detail">本页暂无附件。</p>}
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
            const sealed = attachment.mime === SEALED_ATTACHMENT_MIME;
            const detail = sealed ? undefined : references[attachment.sha256];
            const name = detail?.name ?? (sealed ? `加密附件 · ${attachment.sha256.slice(0, 12)}…` : `${attachment.sha256.slice(0, 12)}…`);
            return (
              <li key={attachment.sha256} className="mn-attachrow">
                {attachment.mime.startsWith("image/")
                  ? <a className="mn-attachthumb" href={attachmentUrl(attachment.sha256)} target="_blank" rel="noreferrer" aria-label={`查看附件 ${name}`}><img src={attachmentUrl(attachment.sha256)} alt={name} loading="lazy" /></a>
                  : <span className="mn-attachthumb mn-attachthumb-file" aria-hidden="true">文件</span>}
                <div className="mn-attachcontent">
                  {sealed ? <span className="mn-attachname">{name}</span>
                    : <a className="mn-attachname" href={attachmentUrl(attachment.sha256)} target="_blank" rel="noreferrer">{name}</a>}
                  <span className="mn-attachmeta">{sealed ? "密文" : attachment.mime} · {formatSize(attachment.size)} · 引用 {attachment.refCount}</span>
                  {sealed ? <span className="mn-attachmeta">在所属笔记解锁后打开</span>
                    : detail?.references.length ? <div className="mn-attachrefs">引用文章：{detail.references.map((ref, index) => <span key={ref.id}>{index > 0 && "、"}<a href={ref.href}>{ref.title}</a></span>)}</div> : null}
                </div>
                {eligible.has(attachment.sha256) && <button type="button" className="mn-textbtn" disabled={loading || cleaning}
                  aria-label={`清理附件 ${name}`} onClick={() => void clean([attachment.sha256])}>清理</button>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
