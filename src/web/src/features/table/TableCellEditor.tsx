import { useEffect, useRef, useState } from "react";
import { joinMultiCell, splitMultiCell } from "../../lib/gfmTable";
import type { PropertyDef, PropertyType } from "../../lib/frontmatter";

interface TableCellEditorProps {
  value: string;
  type: PropertyType;
  /** 字段定义（候选值来源）；无定义的列由调用方按 text 分派（FR-TBL-4/5）。 */
  def?: PropertyDef;
  onChange: (value: string) => void;
}

/** 类型化单元格控件（FR-TBL-7）：表格文档与 Note 内表格弹窗（双轨 FR-TBL-2）共用。
 *  写回契约见 lib/gfmTable（FR-TBL-6）；历史值不静默修正，编辑时才按类型覆盖（FR-TBL-4 精神）。 */
export function TableCellEditor({ value, type, def, onChange }: TableCellEditorProps) {
  if (type === "checkbox") {
    return <CheckboxCell value={value} onChange={onChange} />;
  }
  if (type === "select") {
    const options = def?.options ?? [];
    // 候选必须显式定义（FR-PROP-4）；未定义候选时按文本编辑，候选在列设置中维护。
    if (options.length === 0) return <input className="mn-tcell-input" type="text" value={value} aria-label="单选单元格" onChange={(e) => onChange(e.target.value)} />;
    const known = options.includes(value);
    return (
      <select className="mn-tcell-input" value={known ? value : ""} aria-label="单选单元格"
        onChange={(e) => onChange(e.target.value)}>
        {!known && value !== "" && <option value="">{value}（候选外）</option>}
        <option value="">（空）</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (type === "multiselect") {
    const options = def?.options ?? [];
    if (options.length === 0) {
      return (
        <input className="mn-tcell-input" type="text" value={value} aria-label="多选单元格（逗号分隔）"
          onChange={(e) => onChange(joinMultiCell(splitMultiCell(e.target.value)))} />
      );
    }
    return <MultiSelectCell value={value} options={options} onChange={onChange} />;
  }
  if (type === "date") {
    // 日期控件只接受 ISO 形态；历史自由文本保留原样，清空或改正后回到日期控件。
    if (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return <input className="mn-tcell-input" type="date" value={value} aria-label="日期单元格" onChange={(e) => onChange(e.target.value)} />;
    }
    return <input className="mn-tcell-input" type="text" value={value} aria-label="日期单元格（非标准格式，编辑后按日期处理）" onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <input
      className="mn-tcell-input" type={type === "number" ? "number" : "text"} value={value}
      aria-label={type === "number" ? "数字单元格" : type === "link" ? "链接单元格" : "单元格"}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function CheckboxCell({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const isTrue = value === "true";
  const legacy = value !== "true" && value !== "false" && value !== "";
  return (
    <input
      className="mn-tcell-check" type="checkbox" checked={isTrue}
      title={legacy ? `原值「${value}」，勾选后覆盖为 true/false` : "复选框单元格"}
      aria-label="复选框单元格"
      onChange={(e) => onChange(e.target.checked ? "true" : "false")}
    />
  );
}

/** 多选候选标签勾选（FR-TBL-6 写回契约 joinMultiCell）；候选外的历史值保留展示、可移除。 */
function MultiSelectCell({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
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
      <button type="button" className="mn-tcell-multibtn" aria-label="多选单元格" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        {value || "（空）"}
      </button>
      {open && (
        <div className="mn-tcell-pop" role="group" aria-label="多选候选">
          {options.map((option) => (
            <label key={option} className="mn-tcell-poprow">
              <input type="checkbox" checked={selected.includes(option)} onChange={() => toggle(option)} />
              {option}
            </label>
          ))}
          {extras.map((option) => (
            <label key={option} className="mn-tcell-poprow">
              <input type="checkbox" checked onChange={() => toggle(option)} />
              {option}（候选外）
            </label>
          ))}
          {options.length === 0 && extras.length === 0 && <span className="mn-tcell-pophint">暂无候选</span>}
        </div>
      )}
    </div>
  );
}
