interface TableColumnVisibilityProps {
  columns: string[];
  hidden: string[];
  onChange: (column: string, visible: boolean) => void;
}

/** View control: hiding a field never removes it from the table document. */
export function TableColumnVisibility({ columns, hidden, onChange }: TableColumnVisibilityProps) {
  const visibleCount = columns.filter((column) => !hidden.includes(column)).length;
  return (
    <details className="mn-tabledoc-column-picker">
      <summary>显示字段</summary>
      <div className="mn-tabledoc-column-menu" aria-label="显示或隐藏字段">
        {columns.map((column, index) => {
          const visible = !hidden.includes(column);
          return (
            <label key={`${column}-${index}`}>
              <input type="checkbox" checked={visible} disabled={visible && visibleCount <= 1}
                onChange={(event) => onChange(column, event.target.checked)} />
              <span>{column || `字段 ${index + 1}`}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}
