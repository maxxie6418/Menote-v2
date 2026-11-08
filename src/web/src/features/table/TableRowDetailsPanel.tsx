import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface TableRowDetailsPanelProps {
  rowNumber: number;
  columns: string[];
  cells: string[];
  onClose: () => void;
}

function safeWebUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function CoverPreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <a className="mn-tabledoc-detail-cover-fallback" href={src} target="_blank" rel="noreferrer">封面无法直接加载，打开图片链接</a>;
  return <img className="mn-tabledoc-detail-cover" src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

/** Row detail side panel, with a large preview for Raindrop cover URLs. */
export function TableRowDetailsPanel({ rowNumber, columns, cells, onClose }: TableRowDetailsPanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // onClose 走 ref：父组件传内联闭包时，表格数据刷新重渲染会让陷阱 effect 反复重跑、
  // 把焦点从面板内拽回关闭按钮；与 TagManagerDialog 同一修法。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
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
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const coverIndex = columns.findIndex((column) => /^(cover|封面)$/i.test(column.trim()));
  const coverUrl = coverIndex >= 0 ? safeWebUrl(cells[coverIndex] ?? "") : null;
  const pageIndex = columns.findIndex((column) => /^(网址|链接|url|source|source_url)$/i.test(column.trim()));
  const pageUrl = pageIndex >= 0 ? safeWebUrl(cells[pageIndex] ?? "") : null;

  return (
    <>
      <button type="button" className="mn-tabledoc-detail-backdrop" aria-label="关闭行详情" onClick={onClose} />
      <aside ref={panelRef} className="mn-tabledoc-detail" role="dialog" aria-modal="true" aria-label={`第 ${rowNumber} 行详情`}>
        <header className="mn-tabledoc-detail-head">
          <h2>第 {rowNumber} 行</h2>
          <button ref={closeRef} type="button" className="mn-iconbtn" aria-label="关闭详情" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {pageUrl && <p className="mn-clip-source"><a href={pageUrl} target="_blank" rel="noreferrer">打开原网页</a></p>}
        {coverUrl && <CoverPreview key={coverUrl} src={coverUrl} alt={cells[columns.findIndex((column) => /^(title|标题)$/i.test(column.trim()))] || "收藏封面"} />}
        <dl className="mn-tabledoc-detail-fields">
          {columns.map((column, index) => {
            const value = cells[index] ?? "";
            const url = safeWebUrl(value);
            return (
              <div key={`${column}-${index}`}>
                <dt>{column || `字段 ${index + 1}`}</dt>
                <dd>{url ? <a href={url} target="_blank" rel="noreferrer">{value}</a> : value || <span>—</span>}</dd>
              </div>
            );
          })}
        </dl>
      </aside>
    </>
  );
}
