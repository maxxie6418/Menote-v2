import { FileText, Table2 } from "lucide-react";
import type { Item } from "@menote/shared";
import { NoteEmptyState } from "./NoteEmptyState";
import { formatItemMeta, noteSnippet } from "./format";

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
          {item.type === "table"
            ? <Table2 className="mn-note-row-icon" aria-hidden="true" />
            : <FileText className="mn-note-row-icon" aria-hidden="true" />}
          <span className="mn-note-row-title">{item.title}</span>
          <span className="mn-note-row-meta">{formatItemMeta(item)}</span>
          <span className="mn-note-row-desc">{noteSnippet(item) || "（空白）"}</span>
        </button>
      ))}
    </div>
  );
}
