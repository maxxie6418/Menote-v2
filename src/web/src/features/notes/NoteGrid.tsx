import { FileText, Table2 } from "../../icons";
import type { Item } from "@menote/shared";
import { NoteEmptyState } from "./NoteEmptyState";
import { formatItemMeta, noteSnippet } from "./format";

interface NoteGridProps {
  items: Item[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyDetail: string;
  picking?: boolean;
  pickedIds?: ReadonlySet<string>;
  onTogglePicked?: (id: string, extend: boolean) => void;
}

function snippet(item: Item): string {
  return noteSnippet(item);
}

/** 网格视图（FR-IA-7），卡片进入独立阅读区。 */
export function NoteGrid({ items, selectedId, onSelect, emptyTitle, emptyDetail, picking = false, pickedIds, onTogglePicked }: NoteGridProps) {
  if (!items) return <div className="mn-empty" role="status" aria-busy="true" />;
  if (items.length === 0) return <NoteEmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="mn-notegrid" role="list">
      {items.map((item) => (
        <div key={item.id} className="mn-note-rowline" role="listitem">
        {picking && item.type !== "memo" && (
          <input type="checkbox" className="mn-note-check" checked={pickedIds?.has(item.id) ?? false}
            aria-label={`选择「${item.title ?? "无标题"}」`}
            onChange={(event) => onTogglePicked?.(item.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)} />
        )}
        <button
          type="button"
          className={item.id === selectedId || pickedIds?.has(item.id) ? "mn-note-card on" : "mn-note-card"}
          onClick={(event) => {
            if (picking && item.type !== "memo") onTogglePicked?.(item.id, event.shiftKey);
            else onSelect(item.id);
          }}
        >
          <span className="mn-note-row-title">
            {item.type === "table" && <Table2 size={13} aria-hidden="true" />} {item.title}
          </span>
          <span className="mn-note-card-snippet">{snippet(item) || "（空白）"}</span>
          <span className="mn-note-row-meta">{formatItemMeta(item)}</span>
        </button>
        </div>
      ))}
    </div>
  );
}
