import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import type { PropertyTemplate, PropertyType } from "../../lib/frontmatter";
import {
  PROPS_KEY, type PropRow, type PropertyDef, PROPERTY_TYPES,
  parseOptionList, readPropRows, removePropDef, writeDef, writeValue,
} from "../../lib/frontmatter";
import { readPropertyTemplates } from "../../services/propertyTemplateService";

interface PropertyPanelProps {
  markdown: string;
  userId: string;
  /** 写回经统一文档更新链路（FR-PROP-3）：产出新 markdown，由上层走 saveItemContent 保存。 */
  onSave: (next: string) => void;
}

const TYPE_LABELS: Record<PropertyType, string> = {
  text: "文本",
  multiline: "多行文本",
  number: "数字",
  date: "日期",
  select: "单选",
  multiselect: "多选",
  checkbox: "复选框",
  link: "链接",
};

/**
 * 属性栏（FR-PROP-1/2/9/10）：**两个态**——
 * 换值态（默认；文档预览态同样是它）：值以文本呈现、链接可点，点值就地换成控件，
 *   改完即存收起；属性的定义、增删一律不可见。
 * 编辑态：在换值态之上露出类型/候选定义、每行尾部靠右的删除按钮、底部添加按钮。
 * 预设模板只作「添加属性」的模板库（FR-PROP-9）：加进文档即成为该文档自己的设定。
 */
export function PropertyPanel({ markdown, userId, onSave }: PropertyPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mode, setMode] = useState<"value" | "edit">("value");
  const [adding, setAdding] = useState(false);
  const [templates, setTemplates] = useState<PropertyTemplate[]>([]);
  const rows = useMemo(() => readPropRows(markdown, PROPS_KEY), [markdown]);

  useEffect(() => {
    let cancelled = false;
    void readPropertyTemplates(userId).then((list) => { if (!cancelled) setTemplates(list); });
    return () => { cancelled = true; };
  }, [userId]);

  const onWrite = (row: PropRow, value: string | boolean | string[]) => onSave(writeValue(markdown, row.key, value));
  const onRemove = (row: PropRow) => onSave(removePropDef(markdown, PROPS_KEY, row.key));
  const onDefine = (name: string, def: PropertyDef) => onSave(writeDef(markdown, PROPS_KEY, name, def));
  /** 新增属性：定义与默认值一次写回（先写定义再写值，避免互相覆盖）。 */
  const onAdd = (name: string, def: PropertyDef, value?: string | boolean | string[]) => {
    let next = writeDef(markdown, PROPS_KEY, name, def);
    if (value !== undefined && value !== "") next = writeValue(next, name, value);
    onSave(next);
  };

  if (rows.length === 0 && !adding) {
    return (
      <button type="button" className="mn-propbar-add" onClick={() => { setMode("edit"); setAdding(true); }}>
        <Plus /> 添加属性
      </button>
    );
  }

  return (
    <section className="mn-propbar" aria-label="属性区">
      <div className="mn-propbar-headrow">
        <button type="button" className="mn-propbar-head" aria-expanded={!collapsed} onClick={() => setCollapsed((value) => !value)}>
          <ChevronDown className={collapsed ? "closed" : ""} />
          <span className="mn-seclabel-text">属性（{rows.length}）</span>
        </button>
        {rows.length > 0 && (
          <button type="button" className="mn-textbtn" title="编辑属性的定义，可添加与删除属性"
            onClick={() => { setCollapsed(false); setMode(mode === "edit" ? "value" : "edit"); }}>
            {mode === "edit" ? "完成" : "编辑属性"}
          </button>
        )}
      </div>
      {!collapsed && (
        <dl className="mn-proplist">
          {rows.map((row) => (
            <div key={row.key} className="mn-proprow">
              <dt className="mn-propkey" title={row.key}>{row.def?.label ?? row.key}</dt>
              <dd className={mode === "edit" ? "mn-propvalue editing" : "mn-propvalue"}>
                <PropertyValueCell row={row} onWrite={(value) => onWrite(row, value)} />
                {mode === "edit" && <PropertyTypeEditor row={row} onDefine={(def) => onDefine(row.key, def)} />}
                {mode === "edit" && (
                  <button type="button" className="mn-iconbtn mn-propdel" aria-label={`删除属性 ${row.def?.label ?? row.key}`} onClick={() => onRemove(row)}>
                    <X />
                  </button>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {!collapsed && mode === "edit" && !adding && (
        <button type="button" className="mn-propbar-add" onClick={() => setAdding(true)}>
          <Plus /> 添加属性
        </button>
      )}
      {adding && (
        <AddPropertyRow
          templates={templates}
          onCancel={() => setAdding(false)}
          onAdd={(name, def, value) => { onAdd(name, def, value); setAdding(false); }}
        />
      )}
    </section>
  );
}

/** 只把 http(s) 当链接，避免把其它字符串做成可点地址。 */
function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/.test(value);
}

/**
 * 值槽（FR-PROP-2/10）：默认以文本呈现——链接可点；点值就地换成控件，改完即存收起。
 * 链接型的文本就是链接（点它跳转），改值走编辑态里的控件。
 */
function PropertyValueCell({ row, onWrite }: { row: PropRow; onWrite: (value: string | boolean | string[]) => void }) {
  const [editing, setEditing] = useState(false);
  const type: PropertyType = row.def?.type ?? inferType(row);
  if (editing) {
    return <PropertyValueControl row={row} onWrite={onWrite} onClose={() => setEditing(false)} />;
  }
  if (type === "link") {
    // 链接型的文本就是链接（点它跳转），另给一个「改」入口换值——链接与换值两件事不互相顶掉。
    return (
      <span className="mn-propvalue-link">
        <PropertyValueRead row={row} />
        <button type="button" className="mn-statuslink" aria-label={`修改属性 ${row.def?.label ?? row.key}`}
          onClick={() => setEditing(true)}>改</button>
      </span>
    );
  }
  return (
    <button type="button" className="mn-propopen" onClick={() => setEditing(true)} aria-label={`修改属性 ${row.def?.label ?? row.key}`}>
      <PropertyValueRead row={row} />
    </button>
  );
}

function PropertyValueRead({ row }: { row: PropRow }) {
  const type: PropertyType = row.def?.type ?? inferType(row);
  if (type === "checkbox" || row.isBoolean) {
    return <span className="mn-proptext">{row.raw === "true" ? "是" : "否"}</span>;
  }
  if (type === "multiselect" || row.isArray) {
    if (row.arrayValues.length === 0) return <span className="mn-proptext mn-propempty">—</span>;
    return <span className="mn-proptext">{row.arrayValues.join("、")}</span>;
  }
  const value = row.raw.trim();
  if (!value) return <span className="mn-proptext mn-propempty">—</span>;
  if (isHttpUrl(value)) {
    return <span className="mn-proptext"><a href={value} target="_blank" rel="noreferrer">{value}</a></span>;
  }
  return <span className="mn-proptext">{value}</span>;
}

/** FR-PROP-6 安全推断：仅当控件可无损写回原值时启用对应控件，否则文本。 */
function inferType(row: PropRow): PropertyType {
  if (row.isBoolean) return "checkbox";
  if (row.isArray) return "multiselect";
  if (/^\d{4}-\d{2}-\d{2}$/.test(row.raw)) return "date";
  if (/^[+-]?\d+(\.\d+)?$/.test(row.raw)) return "number";
  if (isHttpUrl(row.raw)) return "link";
  return "text";
}

/** 值编辑控件（就地换）：改完即存并收起。 */
function PropertyValueControl({ row, onWrite, onClose }: {
  row: PropRow;
  onWrite: (value: string | boolean | string[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(row.raw);
  const [multi, setMulti] = useState<string[]>(row.arrayValues);
  const type: PropertyType = row.def?.type ?? inferType(row);

  if (type === "select") {
    const options = row.def?.options ?? [];
    return (
      <select className="mn-propselect" value={row.raw} aria-label={row.key} autoFocus
        onChange={(event) => { onWrite(event.target.value); onClose(); }}
        onBlur={onClose}>
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
        <button type="button" className="mn-textbtn" onClick={onClose}>完成</button>
      </span>
    );
  }
  if (type === "checkbox") {
    return (
      <input
        type="checkbox" checked={row.raw === "true"} aria-label={row.key} autoFocus
        onChange={(event) => { onWrite(event.target.checked); onClose(); }}
      />
    );
  }
  if (type === "multiline") {
    return (
      <textarea
        className="mn-propinput" value={text} rows={2} aria-label={row.key} autoFocus
        onChange={(event) => setText(event.target.value)}
        onBlur={() => { if (text !== row.raw) onWrite(text); onClose(); }}
      />
    );
  }
  const inputType = type === "number" ? "number" : type === "date" ? "date" : type === "link" ? "url" : "text";
  return (
    <input
      type={inputType} className="mn-propinput" value={text} aria-label={row.key} autoFocus
      onChange={(event) => setText(event.target.value)}
      onBlur={() => { if (text !== row.raw) onWrite(text); onClose(); }}
      onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
    />
  );
}

function keptDef(row: PropRow, type: PropertyType, options?: string[]): PropertyDef {
  return {
    type,
    ...(row.def?.label ? { label: row.def.label } : {}),
    ...(options ? { options } : {}),
  };
}

/** 编辑态修改已有属性的类型；单选/多选没有候选时先不写入。改类型不改已有值。 */
function PropertyTypeEditor({ row, onDefine }: { row: PropRow; onDefine: (def: PropertyDef) => void }) {
  const current = row.def?.type ?? inferType(row);
  const [pending, setPending] = useState<PropertyType | null>(null);
  const [optionsText, setOptionsText] = useState((row.def?.options ?? row.arrayValues).join("\n"));
  const shown = pending ?? current;
  const needsOptions = shown === "select" || shown === "multiselect";
  const apply = (type: PropertyType, options: string[] | undefined) => {
    if ((type === "select" || type === "multiselect") && (!options || options.length === 0)) return;
    onDefine(keptDef(row, type, options));
    setPending(null);
  };
  return (
    <span className="mn-proptype">
      <select
        className="mn-propselect" aria-label={`${row.def?.label ?? row.key} 的类型`} value={shown}
        onChange={(event) => {
          const next = event.target.value as PropertyType;
          const options = row.def?.options;
          if ((next === "select" || next === "multiselect") && (!options || options.length === 0)) {
            setPending(next);
            return;
          }
          apply(next, next === "select" || next === "multiselect" ? options : undefined);
        }}
      >
        {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
      </select>
      {needsOptions && (
        <textarea
          className="mn-proptextarea" rows={3} placeholder="候选值：每行一个，或用分号分隔"
          aria-label={`${row.key} 的候选值`} value={optionsText}
          onChange={(event) => setOptionsText(event.target.value)}
          onBlur={() => {
            apply(shown, parseOptionList(optionsText));
          }}
        />
      )}
    </span>
  );
}

/** 新增属性：先列预设模板（点一下即加，带默认值），再给自定义表单（FR-PROP-9）。 */
function AddPropertyRow({ templates, onAdd, onCancel }: {
  templates: PropertyTemplate[];
  onAdd: (name: string, def: PropertyDef, value?: string | boolean | string[]) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [label, setLabel] = useState("");
  const [optionsText, setOptionsText] = useState("");
  const needsOptions = type === "select" || type === "multiselect";
  return (
    <div className="mn-proprow mn-proprow-add">
      {templates.length > 0 && (
        <div className="mn-proptemplates" role="group" aria-label="默认属性预设">
          <span className="mn-proptemplates-label">预设</span>
          {templates.map((template) => (
            <button key={template.id} type="button" className="mn-proptemplate"
              onClick={() => onAdd(template.name, {
                type: template.type,
                ...(template.label ? { label: template.label } : {}),
                ...(template.options ? { options: template.options } : {}),
              }, template.value)}>
              <span className="mn-proptemplate-name">{template.label ?? template.name}</span>
              <span className="mn-proptemplate-type">{TYPE_LABELS[template.type]}</span>
            </button>
          ))}
        </div>
      )}
      <input className="mn-propinput" placeholder="属性名" aria-label="属性名" value={name}
        onChange={(event) => setName(event.target.value)} />
      <select className="mn-propselect" aria-label="属性类型" value={type} onChange={(event) => setType(event.target.value as PropertyType)}>
        {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
      </select>
      <input className="mn-propinput" placeholder="显示名（可选）" aria-label="显示名" value={label}
        onChange={(event) => setLabel(event.target.value)} />
      {needsOptions && (
        <textarea
          className="mn-proptextarea" rows={3} placeholder="候选值：每行一个，或用分号分隔（必填）"
          aria-label="候选值" value={optionsText}
          onChange={(event) => setOptionsText(event.target.value)}
        />
      )}
      <div className="mn-proprow-actions">
        <button type="button" className="mn-textbtn" onClick={() => {
          const clean = name.trim();
          if (!clean) return;
          const options = needsOptions ? parseOptionList(optionsText) : undefined;
          if (needsOptions && (options === undefined || options.length === 0)) return;
          onAdd(clean, {
            type,
            ...(label.trim() ? { label: label.trim() } : {}),
            ...(options ? { options } : {}),
          });
        }}>保存定义</button>
        <button type="button" className="mn-textbtn" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
