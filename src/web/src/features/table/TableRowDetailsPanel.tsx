import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Trash2, X } from "../../icons";
import { safeWebUrl } from "../../lib/safeUrl";
import { extractAttachmentRefs } from "../../lib/attachmentRefs";
import { UnlockedAttachment } from "../attachments";

interface TableRowDetailsPanelProps {
  rowNumber: number;
  visiblePosition: number;
  visibleCount: number;
  columns: string[];
  cells: string[];
  onPrevious?: () => void;
  onNext?: () => void;
  onClose: () => void;
  restoreFocus: () => void;
  /** 删行入口：行号槽只留编号与拖动，删除收进详情（预览态不传）。 */
  onDelete?: () => void;
  attachmentItemId?: string;
}

function CoverPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <a className="mn-tabledoc-detail-cover-fallback" href={src} target="_blank" rel="noreferrer">封面无法直接加载，打开图片链接</a>;
  return <img className="mn-tabledoc-detail-cover" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** Row detail side panel, with a large preview for Raindrop cover URLs. */
export function TableRowDetailsPanel({ rowNumber, visiblePosition, visibleCount, columns, cells, onPrevious, onNext, onClose, restoreFocus, onDelete, attachmentItemId }: TableRowDetailsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // onClose 走 ref：父组件传内联闭包时，表格数据刷新重渲染会让陷阱 effect 反复重跑、
  // 把焦点从面板内拽回关闭按钮；与 TagManagerDialog 同一修法。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const restoreFocusRef = useRef(restoreFocus);
  restoreFocusRef.current = restoreFocus;
  useEffect(() => {
    const panel = panelRef.current;
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
        if (!focusable?.length) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const active = document.activeElement;
      if (active === document.body || panel?.contains(active)) restoreFocusRef.current();
    };
  }, []);
  const navigate = (move?: () => void) => {
    if (!move) return;
    if (panelRef.current) panelRef.current.scrollTop = 0;
    move();
  };
  const coverIndex = columns.findIndex((column) => /^(cover|封面)$/i.test(column.trim()));
  const coverUrl = coverIndex >= 0 ? safeWebUrl(cells[coverIndex] ?? "") : null;
  const pageIndex = columns.findIndex((column) => /^(网址|链接|url|source|source_url)$/i.test(column.trim()));
  const pageUrl = pageIndex >= 0 ? safeWebUrl(cells[pageIndex] ?? "") : null;

  return (
    <>
      <button type="button" className="mn-tabledoc-detail-backdrop" aria-label="关闭行详情" onClick={onClose} />
      <aside ref={panelRef} className="mn-tabledoc-detail" role="dialog" aria-modal="true" aria-label={`第 ${rowNumber} 行详情`}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          navigate(event.key === "ArrowLeft" ? onPrevious : onNext);
        }}>
        <header className="mn-tabledoc-detail-head">
          <div className="mn-tabledoc-detail-title">
            <h2>第 {rowNumber} 行</h2>
            <button ref={closeRef} type="button" className="mn-iconbtn" aria-label="关闭详情" onClick={onClose}><X aria-hidden="true" /></button>
          </div>
          <nav className="mn-tabledoc-detail-nav" aria-label="浏览表格行">
            <button type="button" className="mn-iconbtn" aria-label="上一行" title="上一行（←）" aria-keyshortcuts="ArrowLeft"
              aria-disabled={!onPrevious} onClick={() => navigate(onPrevious)}><ChevronLeft aria-hidden="true" /></button>
            <span className="mn-tabledoc-detail-position" role="status">
              <span aria-hidden="true">{visiblePosition} / {visibleCount}</span>
              <span className="mn-visually-hidden">第 {rowNumber} 行。当前视图第 {visiblePosition} 条，共 {visibleCount} 条</span>
            </span>
            <button type="button" className="mn-iconbtn" aria-label="下一行" title="下一行（→）" aria-keyshortcuts="ArrowRight"
              aria-disabled={!onNext} onClick={() => navigate(onNext)}><ChevronRight aria-hidden="true" /></button>
          </nav>
        </header>
        {pageUrl && <p className="mn-clip-source"><a href={pageUrl} target="_blank" rel="noreferrer">打开原网页</a></p>}
        {coverUrl && <CoverPreview key={coverUrl} src={coverUrl} alt={cells[columns.findIndex((column) => /^(title|标题)$/i.test(column.trim()))] || "收藏封面"} />}
        <dl className="mn-tabledoc-detail-fields">
          {columns.map((column, index) => {
            const value = cells[index] ?? "";
            const url = safeWebUrl(value);
            const attachments = attachmentItemId ? extractAttachmentRefs(value) : [];
            return (
              <div key={`${column}-${index}`}>
                <dt>{column || `字段 ${index + 1}`}</dt>
                <dd>{attachmentItemId && attachments.length ? attachments.map((ref, i) =>
                  <UnlockedAttachment key={`${ref.sha256}-${i}`} itemId={attachmentItemId} {...ref} />)
                  : url ? <a href={url} target="_blank" rel="noreferrer">{value}</a> : value || <span>—</span>}</dd>
              </div>
            );
          })}
        </dl>
        {onDelete && (
          <footer className="mn-tabledoc-detail-foot">
            <button type="button" className="mn-textbtn mn-tabledoc-detail-del" onClick={onDelete}>
              <Trash2 aria-hidden="true" />删除本行
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
