interface NoteEmptyStateProps {
  title: string;
  detail: string;
  shortcut?: string;
}

/* 清单/文档空态（DESIGN §8.3：一句说明 + 快捷键提示，不放插画）。 */
export function NoteEmptyState({ title, detail, shortcut }: NoteEmptyStateProps) {
  return (
    <div className="mn-empty" role="status">
      <div>
        <p className="mn-empty-title">{title}</p>
        <p className="mn-empty-detail">{detail}</p>
        {shortcut && <p className="mn-empty-key">{shortcut}</p>}
      </div>
    </div>
  );
}
