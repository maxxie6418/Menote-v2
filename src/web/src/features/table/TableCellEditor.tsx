import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { joinMultiCell, normalizeCellValue, splitMultiCell } from "../../lib/gfmTable";
import type { OptionColor, PropertyDef, PropertyType } from "../../lib/frontmatter";
import { safeWebUrl } from "../../lib/safeUrl";

interface TableCellEditorProps {
  value: string;
  type: PropertyType;
  /** 字段定义（候选值来源）；无定义的列由调用方按 text 分派（FR-TBL-4/5）。 */
  def?: PropertyDef;
  onChange: (value: string) => void;
  /** 预览态：只呈现内容，不接受任何输入（FR-TBL-20）。 */
  readOnly?: boolean;
  /** 该列开启自动换行：文本类单元格换成多行控件，行高随内容长高。 */
  wrap?: boolean;
}

/** 类型化单元格控件（FR-TBL-7）：表格文档与 Note 内表格弹窗（双轨 FR-TBL-2）共用。
 *  写回契约见 lib/gfmTable（FR-TBL-6）；历史值不静默修正，编辑时才按类型覆盖（FR-TBL-4 精神）。 */
export function TableCellEditor({ value, type, def, onChange, readOnly = false, wrap = false }: TableCellEditorProps) {
  if (readOnly) return <CellContent value={value} type={type} def={def} wrap={wrap} />;
  let editor: ReactNode;
  if (type === "checkbox") {
    editor = <CheckboxCell value={value} onChange={onChange} />;
  } else if (type === "select") {
    const options = def?.options ?? [];
    // 候选必须显式定义（FR-PROP-4）；未定义候选时按文本编辑，候选在列设置中维护。
    if (options.length === 0) editor = <TextCell value={value} onChange={onChange} wrap={wrap} aria-label="单选单元格" />;
    else editor = <SingleSelectCell value={value} options={options} colors={def?.optionColors ?? {}} onChange={onChange} />;
  } else if (type === "multiselect") {
    const options = def?.options ?? [];
    if (options.length === 0) {
      editor = (
        <TextCell value={value} onChange={onChange} wrap={wrap} aria-label="多选单元格（逗号分隔）"
          normalize={(next) => joinMultiCell(splitMultiCell(next))} />
      );
    } else editor = <MultiSelectCell value={value} options={options} colors={def?.optionColors ?? {}} onChange={onChange} />;
  } else if (type === "date") {
    // 日期控件只接受 ISO 形态；历史自由文本保留原样，清空或改正后回到日期控件。
    if (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      editor = <input className="mn-tcell-input" type="date" value={value} title={value} aria-label="日期单元格" onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(normalizeCellValue(e.currentTarget.value))} />;
    } else {
      editor = <input className="mn-tcell-input" type="text" size={Math.max(12, Math.min(80, value.length || 12))} value={value} title={value} aria-label="日期单元格（非标准格式，编辑后按日期处理）" onChange={(e) => onChange(e.target.value)} onBlur={(e) => onChange(normalizeCellValue(e.currentTarget.value))} />;
    }
  } else {
    editor = <TextCell value={value} onChange={onChange} wrap={wrap}
      aria-label={type === "number" ? "数字单元格" : type === "link" ? "链接单元格" : "单元格"}
      numeric={type === "number"} />;
  }
  return <CellEditorShell value={value} onRestore={onChange}>{editor}</CellEditorShell>;
}

/** 文本类单元格：默认单行输入（与历史行为一致），列开启换行时改用自增高多行控件。 */
function TextCell({ value, onChange, wrap, normalize, numeric, "aria-label": ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  wrap: boolean;
  normalize?: (value: string) => string;
  numeric?: boolean;
  "aria-label": string;
}) {
  if (!wrap) {
    return (
      <input className="mn-tcell-input" type={numeric ? "number" : "text"} size={Math.max(12, Math.min(80, value.length || 12))} value={value} title={value} aria-label={ariaLabel}
        onChange={(e) => onChange(normalize ? normalize(e.target.value) : e.target.value)}
        onBlur={(e) => onChange(normalizeCellValue(e.currentTarget.value))} />
    );
  }
  return (
    <GrowingTextarea value={value} ariaLabel={ariaLabel}
      onChange={(next) => onChange(normalize ? normalize(next) : next)}
      onCommit={(next) => onChange(normalizeCellValue(next))} />
  );
}

/** 自增高多行输入：高度跟着内容走，行高随之长高（换行列的「显示全部内容」语义）。 */
function GrowingTextarea({ value, onChange, onCommit, ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    // 离屏行（content-visibility: auto）量不到高度时保持 CSS 兜底高度，不要写成 0。
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`;
  };
  useLayoutEffect(fit, [value]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return (
    <textarea ref={ref} className="mn-tcell-textarea" rows={1} value={value} aria-label={ariaLabel} title={value}
      onChange={(e) => onChange(e.target.value)} onBlur={(e) => onCommit(e.currentTarget.value)} />
  );
}

function CellEditorShell({ value, onRestore, children }: { value: string; onRestore: (value: string) => void; children: ReactNode }) {
  const original = useRef(value);
  const focused = useRef(false);
  const onFocus = (_event: FocusEvent<HTMLDivElement>) => {
    if (focused.current) return;
    original.current = value;
    focused.current = true;
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    focused.current = false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onRestore(original.current);
    (event.target as HTMLElement).blur();
  };
  return <div className="mn-tcell-editor" onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>{children}</div>;
}

/** 预览态只读呈现：与编辑态共用类型与色调，但没有任何可输入控件（FR-TBL-20）。 */
function CellContent({ value, type, def, wrap }: { value: string; type: PropertyType; def?: PropertyDef; wrap: boolean }) {
  const colors = def?.optionColors ?? {};
  if (type === "checkbox") {
    return (
      <span className="mn-tcell-checkwrap">
        <span className={`mn-tcell-checkmark${value === "true" ? " on" : ""}`} aria-hidden="true">{value === "true" ? "✓" : ""}</span>
        {value !== "true" && value !== "false" && value !== "" && <span className="mn-tcell-legacy">{value}</span>}
      </span>
    );
  }
  if (type === "select") return <span className="mn-tcell-pill mn-tcell-pill-single" data-tone={colors[value] ?? "neutral"}>{value || "（空）"}</span>;
  if (type === "multiselect") {
    const selected = splitMultiCell(value);
    return (
      <span className="mn-tcell-readmulti">
        {selected.length === 0
          ? <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone="neutral">（空）</span>
          : selected.map((item) => <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone={colors[item] ?? "neutral"} key={item}>{item}</span>)}
      </span>
    );
  }
  const url = type === "link" ? safeWebUrl(value) : null;
  if (url) {
    return <a className="mn-tcell-text mn-tcell-link" data-wrap={wrap ? "true" : "false"} href={url} target="_blank" rel="noreferrer" title={value}>{value}</a>;
  }
  return <span className="mn-tcell-text" data-wrap={wrap ? "true" : "false"} title={value}>{value || "—"}</span>;
}

function CheckboxCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isTrue = value === "true";
  const legacy = value !== "true" && value !== "false" && value !== "";
  return (
    <span className="mn-tcell-checkwrap">
      <input
        className="mn-tcell-check" type="checkbox" checked={isTrue}
        title={legacy ? `原值「${value}」，勾选后覆盖为 true/false` : "复选框单元格"}
        aria-label="复选框单元格"
        onChange={(e) => onChange(e.target.checked ? "true" : "false")}
      />
      {legacy && <span className="mn-tcell-legacy" aria-label={`历史值：${value}`}>{value}</span>}
    </span>
  );
}

function SingleSelectCell({ value, options, colors, onChange }: {
  value: string; options: string[]; colors: Record<string, OptionColor>; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="mn-tcell-single" ref={rootRef}>
      <button type="button" className="mn-tcell-single-trigger" aria-label="单选单元格" aria-expanded={open} title={value || "空单元格"}
        onClick={() => setOpen((current) => !current)}>
        <span className="mn-tcell-pill mn-tcell-pill-single" data-tone={colors[value] ?? "neutral"}>{value || "（空）"}</span>
      </button>
      {open && (
        <div className="mn-tcell-pop" role="listbox" aria-label="单选候选">
          <button type="button" className="mn-tcell-pickrow" role="option" aria-selected={value === ""}
            onClick={() => { onChange(""); setOpen(false); }}>
            <span className="mn-tcell-pill mn-tcell-pill-single" data-tone="neutral">（空）</span>
          </button>
          {options.map((option) => (
            <button type="button" className="mn-tcell-pickrow" key={option} role="option" aria-selected={value === option}
              onClick={() => { onChange(option); setOpen(false); }}>
              <span className="mn-tcell-pill mn-tcell-pill-single" data-tone={colors[option] ?? "neutral"}>{option}</span>
            </button>
          ))}
          {value && !options.includes(value) && (
            <span className="mn-tcell-pickrow"><span className="mn-tcell-pill mn-tcell-pill-single" data-tone="neutral">{value}（候选外）</span></span>
          )}
        </div>
      )}
    </div>
  );
}

/** 多选候选标签勾选（FR-TBL-6 写回契约 joinMultiCell）；候选外的历史值保留展示、可移除。 */
function MultiSelectCell({ value, options, colors, onChange }: {
  value: string; options: string[]; colors: Record<string, OptionColor>; onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = splitMultiCell(value);
  const extras = selected.filter((item) => !options.includes(item));

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (option: string) => {
    onChange(joinMultiCell(selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option]));
  };

  return (
    <div className="mn-tcell-multi" ref={rootRef}>
      <button type="button" className="mn-tcell-multibtn" aria-label="多选单元格" aria-expanded={open} title={selected.join("，") || "空单元格"}
        onClick={() => setOpen((v) => !v)}>
        {selected.length === 0
          ? <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone="neutral">（空）</span>
          : selected.map((item) => <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone={colors[item] ?? "neutral"} key={item}>{item}</span>)}
      </button>
      {open && (
        <div className="mn-tcell-pop" role="group" aria-label="多选候选">
          {options.map((option) => (
            <label key={option} className="mn-tcell-poprow">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone={colors[option] ?? "neutral"}>{option}</span>
            </label>
          ))}
          {extras.map((option) => (
            <label key={option} className="mn-tcell-poprow">
              <input type="checkbox" checked onChange={() => toggle(option)} />
              <span className="mn-tcell-pill mn-tcell-pill-multi" data-tone="neutral">{option}（候选外）</span>
            </label>
          ))}
          {options.length === 0 && extras.length === 0 && <span className="mn-tcell-pophint">暂无候选</span>}
        </div>
      )}
    </div>
  );
}
