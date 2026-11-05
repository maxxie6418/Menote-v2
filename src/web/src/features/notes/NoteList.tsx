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
  onAiSummary?: (item: Item) => void;
  /** 多选模式：勾选不打开文档。Memo 不参与移动，故不可勾选。 */
  picking?: boolean;
  pickedIds?: ReadonlySet<string>;
  onTogglePicked?: (id: string, extend: boolean) => void;
}

/** 清单视图（FR-IA-3 穿透聚合后的扁平列表；行样式自 M1.2 git 历史恢复）。 */
export function NoteList({ items, selectedId, onSelect, emptyTitle, emptyDetail, onMove, onToggleStar, onTrash, onAiSummary, picking = false, pickedIds, onTogglePicked }: NoteListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: Item; trigger: HTMLElement } | null>(null);
  if (!items) return <div className="mn-empty" role="status" aria-busy="true" />;
  if (items.length === 0) return <NoteEmptyState title={emptyTitle} detail={emptyDetail} />;
  return (
    <div className="mn-notelist" role="list">
      {items.map((item) => (
        <div key={item.id} className="mn-note-rowline" role="listitem">
        {picking && item.type !== "memo" && (
          <input
            type="checkbox"
            className="mn-note-check"
            checked={pickedIds?.has(item.id) ?? false}
            aria-label={`选择「${item.title ?? "无标题"}」`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onTogglePicked?.(item.id, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)}
          />
        )}
        <button
          type="button"
          draggable={item.type !== "memo" && !picking}
          className={item.id === selectedId || pickedIds?.has(item.id) ? "mn-note-row on" : "mn-note-row"}
          aria-haspopup={onMove && onToggleStar && onTrash ? "menu" : undefined}
          aria-expanded={contextMenu?.item.id === item.id}
          onClick={(event) => {
            if (picking && item.type !== "memo") {
              onTogglePicked?.(item.id, event.shiftKey);
              return;
            }
            onSelect(item.id);
          }}
          onDragStart={(event) => {
            if (item.type === "memo") { event.preventDefault(); return; }
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-menote-item", item.id);
            if (item.content.scope === "private_space") event.dataTransfer.setData("application/x-menote-private-item", item.id);
          }}
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
        </div>
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
          onAiSummary={onAiSummary ? () => onAiSummary(contextMenu.item) : undefined}
        />
      )}
    </div>
  );
}

function NoteContextMenu({
  item, x, y, returnFocus, onClose, onMove, onToggleStar, onTrash, onAiSummary,
}: {
  item: Item;
  x: number;
  y: number;
  returnFocus: HTMLElement;
  onClose: () => void;
  onMove: () => void;
  onToggleStar: () => void;
  onTrash: () => void;
  onAiSummary?: () => void;
}) {
  const canSummarize = item.type === "note" && item.content.scope === "plain" && onAiSummary;
  const actions: ContextMenuAction[] = [
    { label: "移动到…", onSelect: onMove },
    { label: item.starred ? "取消收藏" : "加入收藏", onSelect: onToggleStar },
    ...(canSummarize ? [{ label: "AI 概述", onSelect: onAiSummary, separatorBefore: true }] : []),
    { label: "移入回收站", onSelect: onTrash, destructive: true, separatorBefore: true },
  ];
  return <ContextMenu x={x} y={y} label={`笔记「${item.title}」操作`} actions={actions} onClose={onClose} returnFocus={returnFocus} />;
}
