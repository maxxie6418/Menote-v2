import { useMemo, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { PropertyType } from "../../lib/frontmatter";
import {
  PROPS_KEY, type PropRow, type PropertyDef, PROPERTY_TYPES,
  readPropRows, removeProp, writeDef, writeValue,
} from "../../lib/frontmatter";

interface PropertyPanelProps {
  markdown: string;
  /** 写回经统一文档更新链路（FR-PROP-3）：产出新 markdown，由上层走 saveItemContent 保存。 */
  onSave: (next: string) => void;
}

/** 属性区（FR-PROP-1/2）：轻量排版、点击值直接编辑、可折叠；空文档不铺空字段；
 *  预览态同样可编辑（FR-PROP-3）；无定义键按值安全推断（FR-PROP-6）；
 *  外来键与未知值文本降级、原样写回（FR-PROP-7）；属性区多选为原生数组（FR-PROP-8）。 */
export function PropertyPanel({ markdown, onSave }: PropertyPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [adding, setAdding] = useState(false);
  const rows = useMemo(() => readPropRows(markdown, PROPS_KEY), [markdown]);

  const onWrite = (row: PropRow, value: string | boolean | string[]) => onSave(writeValue(markdown, row.key, value));
  const onRemove = (row: PropRow) => onSave(removeProp(markdown, row.key));
  const onAdd = (name: string, def: PropertyDef) => onSave(writeDef(markdown, PROPS_KEY, name, def));

  if (rows.length === 0 && !adding) {
    return (
      <button type="button" className="mn-propbar-add" onClick={() => setAdding(true)}>
        <Plus /> 添加属性
      </button>
    );
  }

  return (
    <section className="mn-propbar" aria-label="属性区">
      <button type="button" className="mn-propbar-head" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
        <ChevronDown className={collapsed ? "closed" : ""} />
        <span className="mn-seclabel-text">属性（{rows.length}）</span>
      </button>
      {!collapsed && (
        <dl className="mn-proplist">
          {rows.map((row) => (
            <div key={row.key} className="mn-proprow">
              <dt className="mn-propkey" title={row.key}>{row.def?.label ?? row.key}</dt>
              <dd className="mn-propvalue">
                <PropertyValueControl row={row} onWrite={(value) => onWrite(row, value)} />
                <button type="button" className="mn-iconbtn" aria-label={`删除属性 ${row.def?.label ?? row.key}`} onClick={() => onRemove(row)}>
                  <X />
                </button>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {adding && (
        <AddPropertyRow
          onCancel={() => setAdding(false)}
          onAdd={(name, def) => { onAdd(name, def); setAdding(false); }}
        />
      )}
    </section>
  );
}

/** FR-PROP-6 安全推断：仅当控件可无损写回原值时启用对应控件，否则文本。 */
function inferType(row: PropRow): PropertyType {
  if (row.isBoolean) return "checkbox";
  if (row.isArray) return "multiselect";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.raw)) return "date";
  if (/^[+-]?\d+(\.\d+)?$/.test(row.raw)) return "number";
  if (/^https?:\/\/\S+$/.test(row.raw)) return "link";
  return "text";
}

function PropertyValueControl({ row, onWrite }: { row: PropRow; onWrite: (value: string | boolean | string[]) => void }) {
  const [text, setText] = useState(row.raw);
  const [multi, setMulti] = useState<string[]>(row.arrayValues);
  const type: PropertyType = row.def?.type ?? inferType(row);

  if (type === "select") {
    const options = row.def?.options ?? [];
    return (
      <select className="mn-propselect" value={row.raw} aria-label={row.key}
        onChange={(event) => onWrite(event.target.value)}>
        {!row.raw && <option value="">请选择…</option>}
        {row.raw && !options.includes(row.raw) && <option value={row.raw}>{row.raw}（未在候选中）</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (type === "multiselect") {
    const options = row.def?.options ?? [...new Set([...multi, ...row.arrayValues])];
    return (
      <span className="mn-propmulti" role="group" aria-label={row.key}>
        {options.map((option) => (
          <label key={option} className="mn-propmulti-option">
            <input
              type="checkbox" checked={multi.includes(option)}
              onChange={(event) => {
                const next = event.target.checked ? [...multi, option] : multi.filter((value) => value !== option);
                setMulti(next);
                onWrite(next);
              }}
            />
            {option}
          </label>
        ))}
      </span>
    );
  }
  if (type === "checkbox") {
    return (
      <input
        type="checkbox" checked={row.raw === "true"} aria-label={row.key}
        onChange={(event) => onWrite(event.target.checked)}
      />
    );
  }
  if (type === "multiline") {
    return (
      <textarea
        className="mn-propinput" value={text} rows={2} aria-label={row.key}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => { if (text !== row.raw) onWrite(text); }}
      />
    );
  }
  const inputType = type === "number" ? "number" : type === "date" ? "date" : type === "link" ? "url" : "text";
  return (
    <input
      type={inputType} className="mn-propinput" value={text} aria-label={row.key}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => { if (text !== row.raw) onWrite(text); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

function AddPropertyRow({ onAdd, onCancel }: { onAdd: (name: string, def: PropertyDef) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [label, setLabel] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const needsOptions = type === "select" || type === "multiselect";
  return (
    <div className="mn-proprow mn-proprow-add">
      <input className="mn-propinput" placeholder="属性名" aria-label="属性名" value={name}
        onChange={(event) => setName(event.target.value)} />
      <select className="mn-propselect" aria-label="属性类型" value={type} onChange={(event) => setType(event.target.value as PropertyType)}>
        {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
      <input className="mn-propinput" placeholder="显示名（可选）" aria-label="显示名" value={label}
        onChange={(event) => setLabel(event.target.value)} />
      {needsOptions && (
        <input className="mn-propinput" placeholder="候选值，逗号分隔（必填）" aria-label="候选值" value={optionsText}
          onChange={(event) => setOptionsText(event.target.value)} />
      )}
      <div className="mn-proprow-actions">
        <button type="button" className="mn-minibtn" onClick={() => {
          const clean = name.trim();
          if (!clean) return;
          const options = needsOptions
            ? optionsText.split(",").map((option) => option.trim()).filter(Boolean)
            : undefined;
          if (needsOptions && (options === undefined || options.length === 0)) return;
          onAdd(clean, {
            type,
            ...(label.trim() ? { label: label.trim() } : {}),
            ...(options ? { options } : {}),
          });
        }}>保存定义</button>
        <button type="button" className="mn-minibtn" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
