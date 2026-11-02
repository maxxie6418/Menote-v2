import { useState } from "react";
import { FileText, MessageCircle, Table2 } from "lucide-react";
import type { Item } from "@menote/shared";
import { NoteEmptyState } from "./NoteEmptyState";
import { formatItemMeta, noteSnippet } from "./format";
import { ContextMenu, type ContextMenuAction } from "../../components/ui/ContextMenu";

interface NoteListProps {
  items: Item[] | undefined;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyTitle: string;
  emptyDetail: string;
  onMove?: (item: Item) => void;
  onToggleStar?: (item: Item) => void;
  onTrash?: (item: Item) => void;
}

/** 清单视图（FR-IA-3 穿透聚合后的扁平列表；行样式自 M1.2 git 历史恢复）。 */
export function NoteList({ items, selectedId, onSelect, emptyTitle, emptyDetail, onMove, onToggleStar, onTrash }: NoteListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: Item; trigger: HTMLElement } | null>(null);
  if (!items) return <div className="mn-empty" role="status" aria-busy="true" />;
  if (items.length === 0) return <NoteEmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="mn-notelist" role="list">
      {items.map((item) => (
        <button
          key={item.id} type="button" role="listitem"
          className={item.id === selectedId ? "mn-note-row on" : "mn-note-row"}
          aria-haspopup={onMove && onToggleStar && onTrash ? "menu" : undefined}
          aria-expanded={contextMenu?.item.id === item.id}
          onClick={() => onSelect(item.id)}
          onContextMenu={(event) => {
            if (!onMove || !onToggleStar || !onTrash) return;
            event.preventDefault();
            setContextMenu({ x: event.clientX, y: event.clientY, item, trigger: event.currentTarget });
          }}
          onKeyDown={(event) => {
            if (!onMove || !onToggleStar || !onTrash) return;
            if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            setContextMenu({ x: bounds.left, y: bounds.bottom, item, trigger: event.currentTarget });
          }}
        >
          {item.type === "table"
            ? <Table2 className="mn-note-row-icon" aria-hidden="true" />
            : item.type === "memo" ? <MessageCircle className="mn-note-row-icon" aria-hidden="true" />
              : <FileText className="mn-note-row-icon" aria-hidden="true" />}
          <span className="mn-note-row-title">{item.title ?? (item.type === "memo" ? noteSnippet(item).slice(0, 36) || "无标题" : "无标题")}</span>
          <span className="mn-note-row-meta">{formatItemMeta(item)}</span>
          <span className="mn-note-row-desc">{noteSnippet(item) || "（空白）"}</span>
        </button>
      ))}
      {contextMenu && onMove && onToggleStar && onTrash && (
        <NoteContextMenu
          item={contextMenu.item}
          x={contextMenu.x}
          y={contextMenu.y}
          returnFocus={contextMenu.trigger}
          onClose={() => setContextMenu(null)}
          onMove={() => onMove(contextMenu.item)}
          onToggleStar={() => onToggleStar(contextMenu.item)}
          onTrash={() => onTrash(contextMenu.item)}
        />
      )}
    </div>
  );
}

function NoteContextMenu({
  item, x, y, returnFocus, onClose, onMove, onToggleStar, onTrash,
}: {
  item: Item;
  x: number;
  y: number;
  returnFocus: HTMLElement;
  onClose: () => void;
  onMove: () => void;
  onToggleStar: () => void;
  onTrash: () => void;
}) {
  const actions: ContextMenuAction[] = [
    { label: "移动到…", onSelect: onMove },
    { label: item.starred ? "取消收藏" : "加入收藏", onSelect: onToggleStar },
    { label: "移入回收站", onSelect: onTrash, destructive: true, separatorBefore: true },
  ];
  return <ContextMenu x={x} y={y} label={`笔记「${item.title}」操作`} actions={actions} onClose={onClose} returnFocus={returnFocus} />;
}
