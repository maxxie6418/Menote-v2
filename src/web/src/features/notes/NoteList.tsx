import type { Item } from "@menote/shared";
import { NoteEmptyState } from "./NoteEmptyState";
import { formatItemMeta } from "./format";

interface NoteListProps {
  items: Item[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyDetail: string;
}

/** 清单视图（FR-IA-3 穿透聚合后的扁平列表；行样式自 M1.2 git 历史恢复）。 */
export function NoteList({ items, selectedId, onSelect, emptyTitle, emptyDetail }: NoteListProps) {
  if (!items) return <div className="mn-empty" role="status" aria-busy="true" />;
  if (items.length === 0) return <NoteEmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="mn-notelist" role="list">
      {items.map((item) => (
        <button
          key={item.id} type="button" role="listitem"
          className={item.id === selectedId ? "mn-note-row on" : "mn-note-row"}
          onClick={() => onSelect(item.id)}
        >
          <span className="mn-note-row-title">{item.title}</span>
          <span className="mn-note-row-meta">
            {item.tags.length > 0 && <span className="mn-note-row-tags">{item.tags.map((tag) => `#${tag}`).join(" ")}</span>}
            <span>{formatItemMeta(item)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
