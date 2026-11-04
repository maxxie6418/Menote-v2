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

/** Row detail side panel, with a large preview for Raindrop cover URLs. */
export function TableRowDetailsPanel({ rowNumber, columns, cells, onClose }: TableRowDetailsPanelProps) {
  const coverIndex = columns.findIndex((column) => /^(cover|封面)$/i.test(column.trim()));
  const coverUrl = coverIndex >= 0 ? safeWebUrl(cells[coverIndex] ?? "") : null;

  return (
    <>
      <button type="button" className="mn-tabledoc-detail-backdrop" aria-label="关闭行详情" onClick={onClose} />
      <aside className="mn-tabledoc-detail" aria-label={`第 ${rowNumber} 行详情`}>
        <header className="mn-tabledoc-detail-head">
          <h2>第 {rowNumber} 行</h2>
          <button type="button" className="mn-iconbtn" aria-label="关闭详情" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        {coverUrl && <img className="mn-tabledoc-detail-cover" src={coverUrl} alt={cells[columns.findIndex((column) => /^(title|标题)$/i.test(column.trim()))] || "收藏封面"} loading="lazy" />}
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
