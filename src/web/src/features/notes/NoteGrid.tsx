import type { Item } from "@menote/shared";
import { NoteEmptyState } from "./NoteEmptyState";
import { formatItemMeta } from "./format";

interface NoteGridProps {
  items: Item[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyDetail: string;
}

function snippet(item: Item): string {
  if (item.content.scope !== "plain") return "已加密";
  const text = item.content.markdown.replace(/[#>*`\-\[\]]/g, "").trim();
  return text.slice(0, 80);
}

/** 网格视图（FR-IA-7），卡片进入独立阅读区。 */
export function NoteGrid({ items, selectedId, onSelect, emptyTitle, emptyDetail }: NoteGridProps) {
  if (!items) return <div className="mn-empty" role="status" aria-busy="true" />;
  if (items.length === 0) return <NoteEmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="mn-notegrid" role="list">
      {items.map((item) => (
        <button
          key={item.id} type="button" role="listitem"
          className={item.id === selectedId ? "mn-note-card on" : "mn-note-card"}
          onClick={() => onSelect(item.id)}
        >
          <span className="mn-note-row-title">{item.title}</span>
          <span className="mn-note-card-snippet">{snippet(item) || "（空白）"}</span>
          <span className="mn-note-row-meta">{formatItemMeta(item)}</span>
        </button>
      ))}
    </div>
  );
}
