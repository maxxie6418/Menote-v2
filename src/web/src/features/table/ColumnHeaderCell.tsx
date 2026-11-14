import { useEffect, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from "../../icons";
import { OPTION_COLORS, type OptionColor, type PropertyDef, type PropertyType } from "../../lib/frontmatter";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { FIELD_TYPE_LABELS, FieldTypeMenu } from "./FieldTypeMenu";

const OPTION_COLOR_LABELS: Record<OptionColor, string> = {
  neutral: "默认", red: "红", orange: "橙", yellow: "黄", green: "绿", teal: "青", blue: "蓝", purple: "紫", pink: "粉",
};

interface ColumnHeaderCellProps {
  name: string;
  index: number;
  dragging: boolean;
  readOnly: boolean;
  draft: string | undefined;
  type: PropertyType;
  def: PropertyDef | undefined;
  optionColors: Record<string, OptionColor>;
  /** 该列是否自动换行（决定单元格是否长高显示全部内容）。 */
  wrap: boolean;
  menuOpen: boolean;
  error: string | null;
  sortDirection: "asc" | "desc" | null;
  widthLevel: number;
  onColumnDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
  onTouchColumnDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onColumnDragEnd: () => void;
  onColumnDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onSort: () => void;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResize: (level: number) => void;
  onDraft: (value: string) => void;
  onCommit: () => void;
  onToggle: () => void;
  onClose: () => void;
  onPick: (type: PropertyType) => void;
  onOptions: (raw: string) => void;
  onColor: (option: string, color: OptionColor | null) => void;
  onWrapChange: (wrap: boolean) => void;
  onDelete: () => void;
}

/** 已有字段的表头：默认只露字段名，排序与类型在悬停该列时浮出（FR-TBL-19）。
 *  类型菜单挂到该列下方（portal，不被滚动容器裁切），顺手放「裁切 / 自动换行」。 */
export function ColumnHeaderCell({
  name, index, dragging, readOnly, draft, type, def, optionColors, wrap, menuOpen, error, sortDirection, widthLevel,
  onColumnDragStart, onTouchColumnDragStart, onColumnDragEnd, onColumnDrop, onSort, onResizeStart, onResize,
  onDraft, onCommit, onToggle, onClose, onPick, onOptions, onColor, onWrapChange, onDelete,
}: ColumnHeaderCellProps) {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const options = (def?.options ?? []).join("\n");
  return (
    <div className={`mn-tabledoc-hcell mn-tabledoc-colw-${widthLevel}${dragging ? " dragging" : ""}${readOnly ? " readonly" : ""}`}
      role="columnheader" ref={setAnchor} data-column-index={index} data-wrap={wrap ? "true" : "false"}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-menote-column")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
      onDrop={onColumnDrop}>
      {!readOnly && (
        <button type="button" className="mn-tabledoc-col-drag" aria-label={`拖动第 ${index + 1} 列调整顺序`} title="拖动调整列顺序"
          draggable onPointerDown={onTouchColumnDragStart} onDragStart={onColumnDragStart} onDragEnd={onColumnDragEnd}><GripVertical aria-hidden="true" /></button>
      )}
      {readOnly ? (
        <span className="mn-tabledoc-hname mn-tabledoc-hname-static" title={name}>{name}</span>
      ) : (
        <input
          className="mn-tabledoc-hname" value={draft ?? name} aria-label={`字段名（${name}）`} title={draft ?? name}
          onChange={(event) => onDraft(event.target.value)}
          onBlur={onCommit}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
        />
      )}
      {!readOnly && (
        <>
          <button type="button" className={`mn-tabledoc-sort${sortDirection ? " active" : ""}`}
            aria-label={`按${name}排序${sortDirection ? `，当前${sortDirection === "asc" ? "升序" : "降序"}` : ""}`}
            title={sortDirection === "asc" ? "升序（再次点击降序）" : sortDirection === "desc" ? "降序（再次点击升序）" : "排序"} onClick={onSort}>
            {sortDirection === "desc" ? <ArrowDown aria-hidden="true" /> : sortDirection === "asc" ? <ArrowUp aria-hidden="true" /> : <ArrowUpDown aria-hidden="true" />}
          </button>
          <button type="button" className="mn-tabledoc-hbadge" aria-label={`字段类型：${FIELD_TYPE_LABELS[type]}`}
            aria-expanded={menuOpen} onClick={onToggle} data-panel-trigger>
            {FIELD_TYPE_LABELS[type]}
          </button>
          <button type="button" className="mn-tabledoc-colresize" aria-label={`调整${name}列宽`} title="拖动调整列宽"
            onPointerDown={(event) => { event.preventDefault(); onResizeStart(event); }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const direction = event.key === "ArrowRight" ? 1 : -1;
              const next = Math.max(0, Math.min(7, widthLevel + direction));
              onResize(next);
            }} />
        </>
      )}
      {!readOnly && menuOpen && anchor && (
        <AnchoredPanel className="mn-tabledoc-hmenu" anchor={anchor} label={`字段设置：${name}`}
          layoutKey={`${type}:${options}:${JSON.stringify(optionColors)}:${wrap}:${error ?? ""}`} onClose={onClose}>
          {error && <p className="mn-tabledoc-error" role="alert">{error}</p>}
          <FieldTypeMenu value={def?.type ?? type} onPick={onPick} />
          <div className="mn-tabledoc-display">
            <span className="mn-tabledoc-display-title">内容显示</span>
            <div className="mn-tabledoc-segmented" role="group" aria-label="内容显示方式">
              <button type="button" aria-pressed={!wrap} onClick={() => onWrapChange(false)}>裁切</button>
              <button type="button" aria-pressed={wrap} onClick={() => onWrapChange(true)}>自动换行</button>
            </div>
          </div>
          {def && (def.type === "select" || def.type === "multiselect") && (
            <>
              <label className="mn-tabledoc-optedit">
                候选值（每行一个，禁含逗号）
                <textarea rows={4} value={options} onChange={(event) => onOptions(event.target.value)} />
              </label>
              {(def.options ?? []).length > 0 && (
                <div className="mn-tabledoc-colors">
                  <span className="mn-tabledoc-colors-title">候选值颜色</span>
                  {(def.options ?? []).map((option, optionIndex) => (
                    <div className="mn-tabledoc-color-row" key={`${option}-${optionIndex}`}>
                      <span className="mn-tcell-pill" data-tone={optionColors[option] ?? "neutral"}>{option}</span>
                      <div className="mn-tabledoc-color-palette" role="group" aria-label={`${option} 的颜色`}>
                        {OPTION_COLORS.map((color) => (
                          <button key={color} type="button" className="mn-tabledoc-colorswatch"
                            data-tone={color} aria-label={`${option}：${OPTION_COLOR_LABELS[color]}`}
                            aria-pressed={(optionColors[option] ?? "neutral") === color}
                            onClick={() => onColor(option, color === "neutral" ? null : color)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <button type="button" className="mn-tabledoc-hdel" onClick={onDelete}>删除字段</button>
        </AnchoredPanel>
      )}
    </div>
  );
}

/** 加字段落在表尾新列：名称在该列表头，类型和确认挂在这一列下面。 */
export function AddColumnForm({ onConfirm, onCancel, onEdit, taken, error }: {
  onConfirm: (name: string, type: PropertyType, options?: string[]) => void;
  onCancel: () => void;
  onEdit: () => void;
  taken: string[];
  error: string | null;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null);
  const duplicate = name.trim() !== "" && taken.includes(name.trim());
  const canAdd = name.trim() !== "" && !duplicate;
  const message = duplicate ? `字段名「${name.trim()}」已存在` : error;
  useEffect(() => {
    anchor?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [anchor]);
  return (
    <>
      <div ref={setAnchor} className="mn-tabledoc-hcell mn-tabledoc-addcol mn-tabledoc-colw-0" role="columnheader">
        <input
          className="mn-tabledoc-hname" value={name} autoFocus aria-label="字段名" placeholder="字段名"
          aria-invalid={duplicate || undefined} autoComplete="off"
          onChange={(event) => { setName(event.target.value); onEdit(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && canAdd) onConfirm(name, type);
            if (event.key === "Escape") onCancel();
          }}
        />
      </div>
      {anchor && (
        <AnchoredPanel className="mn-tabledoc-hmenu" anchor={anchor} label="添加字段" layoutKey={`${type}:${message ?? ""}`} onClose={onCancel}>
          {message && <p className="mn-tabledoc-error" role="alert">{message}</p>}
          <FieldTypeMenu value={type} onPick={setType} />
          <div className="mn-tabledoc-addform-actions">
            <button type="button" className="mn-auth-submit" disabled={!canAdd} onClick={() => onConfirm(name, type)}>添加</button>
            <button type="button" className="mn-auth-link" onClick={onCancel}>取消</button>
          </div>
        </AnchoredPanel>
      )}
    </>
  );
}

export function AddColumnSpacer() {
  return <div className="mn-tabledoc-cell mn-tabledoc-addcol mn-tabledoc-colw-0" role="presentation" />;
}
