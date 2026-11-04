import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Plus, X } from "lucide-react";
import type { PropertyDef, PropertyTemplate, PropertyType } from "../../lib/frontmatter";
import {
  PROPS_KEY, readPropRows, removePropDef, renameProp, writeDef, writeValue, type PropRow,
} from "../../lib/frontmatter";
import { readPropertyTemplates } from "../../services/propertyTemplateService";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { AddPropertyPopover } from "./AddPropertyPopover";
import { PropertySettingsPopover } from "./PropertySettingsPopover";
import { inferType, isHttpUrl, PROPS_TWO_COLUMN_MIN, SPAN_TYPES } from "./propsShared";

interface PropertyPanelProps {
  markdown: string;
  userId: string;
  /** 写回经统一文档更新链路（FR-PROP-3）：产出新 markdown，由上层走 saveItemContent 保存。 */
  onSave: (next: string) => Promise<boolean> | boolean | void;
}

/**
 * 属性区（FR-PROP-1/2/9/10）：**不再分「换值态 / 编辑态」两态**——
 * · 值就地改：点值换成控件，回车或失焦即存、Esc 还原；
 * · 定义在行尾 ⋯：键名、显示名、类型、候选值、删除都在这一层的浮层里；
 * · 添加走 + 属性浮层：搜索 → 分组预设 → 新建，一次只做一件事。
 * 布局默认双列，链接与多行文本整行跨列；栏宽不足由 CSS 容器查询回落单列。
 * 预设模板只作「添加属性」的模板库（FR-PROP-9）：加进文档即成为该文档自己的设定。
 */
export function PropertyPanel({ markdown, userId, onSave }: PropertyPanelProps) {
  const rows = useMemo(() => readPropRows(markdown, PROPS_KEY), [markdown]);
  const [templates, setTemplates] = useState<PropertyTemplate[]>([]);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [settings, setSettings] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [optionPick, setOptionPick] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ text: string; restore: string; index: number } | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState<1 | 2>(2);

  /* 双列与否看「文档栏宽」而不是窗口宽度：ResizeObserver 盯住属性区自身，跨过阈值才写 data-columns */
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setColumns(width > 0 && width < PROPS_TWO_COLUMN_MIN ? 1 : 2);
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readPropertyTemplates(userId).then((list) => { if (!cancelled) setTemplates(list); });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!undo) return;
    const timer = window.setTimeout(() => setUndo(null), 6_000);
    return () => window.clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1_400);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const existing = useMemo(() => new Set(rows.map((row) => row.key)), [rows]);

  const writeCell = (row: PropRow, value: string | boolean | string[]) => {
    const next = writeValue(markdown, row.key, value);
    if (next !== markdown) onSave(next);
  };

  const defineRow = (row: PropRow, def: PropertyDef) => onSave(writeDef(markdown, PROPS_KEY, row.key, def));

  const persistAddedProperty = async (next: string, name: string) => {
    setSaveError(null);
    try {
      const saved = await onSave(next);
      if (saved === false) {
        setSaveError("属性未能保存，请检查文档底部的保存状态后重试。");
        return;
      }
      setAdding(null);
      setFlash(name);
    } catch {
      setSaveError("属性未能保存，请重试。");
    }
  };

  const addTemplate = (template: PropertyTemplate) => {
    const def: PropertyDef = {
      type: template.type,
      ...(template.label ? { label: template.label } : {}),
      ...(template.options?.length ? { options: template.options } : {}),
    };
    let next = writeDef(markdown, PROPS_KEY, template.name, def);
    if (template.value !== undefined && template.value !== "") next = writeValue(next, template.name, template.value);
    void persistAddedProperty(next, template.name);
  };

  const createProperty = (name: string, def: PropertyDef, value?: string | boolean | string[]) => {
    let next = writeDef(markdown, PROPS_KEY, name, def);
    if (value !== undefined && value !== "") next = writeValue(next, name, value);
    void persistAddedProperty(next, name);
  };

  const removeRow = (row: PropRow) => {
    const index = rows.findIndex((entry) => entry.key === row.key);
    onSave(removePropDef(markdown, PROPS_KEY, row.key));
    setSettings(null);
    setUndo({ text: `已删除「${row.def?.label ?? row.key}」`, restore: markdown, index });
  };

  const settingsRow = settings ? rows.find((row) => row.key === settings.key) ?? null : null;
  const optionRow = optionPick ? rows.find((row) => row.key === optionPick.key) ?? null : null;

  return (
    <section ref={sectionRef} className="mn-props" data-columns={columns} aria-label="属性区">
      <div className="mn-props-head">
        <span className="mn-props-title">属性</span>
        <span className="mn-props-count">{rows.length}</span>
        <button
          type="button" className="mn-props-add" data-panel-trigger
          aria-expanded={adding !== null} title="添加属性"
          onClick={(event) => setAdding(adding ? null : event.currentTarget)}
        >
          <Plus aria-hidden />属性
        </button>
      </div>

      <div className="mn-props-list">
        {rows.length === 0 && (
          <button type="button" className="mn-props-empty" data-panel-trigger onClick={(event) => setAdding(event.currentTarget)}>
            <Plus aria-hidden />添加属性
          </button>
        )}
        {rows.map((row, index) => {
          const type = row.def?.type ?? inferType(row);
          return (
            <Fragment key={row.key}>
              {undo?.index === index && (
                <div className="mn-props-undo" role="status">
                  <span>{undo.text}</span>
                  <button type="button" onClick={() => { onSave(undo.restore); setUndo(null); }}>撤销</button>
                </div>
              )}
              <div className={`mn-props-row${SPAN_TYPES.has(type) ? " span" : ""}${flash === row.key ? " flash" : ""}`}>
                <span className="mn-props-key" title={row.key}>{row.def?.label ?? row.key}</span>
                <div className="mn-props-value">
                  <PropertyValue
                    row={row} type={type} editing={editing === row.key}
                    onStartEdit={() => { setEditing(row.key); setSettings(null); }}
                    onCommit={(value) => { setEditing(null); writeCell(row, value); }}
                    onCancel={() => setEditing(null)}
                    onPickOptions={(anchor) => setOptionPick({ key: row.key, anchor })}
                  />
                </div>
                <button
                  type="button" className="mn-props-more" data-panel-trigger
                  aria-expanded={settings?.key === row.key} aria-label={`属性设置：${row.def?.label ?? row.key}`}
                  title="属性设置"
                  onClick={(event) => {
                    const anchor = event.currentTarget;
                    setEditing(null);
                    setSettings((current) => (current?.key === row.key ? null : { key: row.key, anchor }));
                  }}
                >
                  <MoreHorizontal aria-hidden />
                </button>
              </div>
            </Fragment>
          );
        })}
        {undo && undo.index >= rows.length && (
          <div className="mn-props-undo" role="status">
            <span>{undo.text}</span>
            <button type="button" onClick={() => { onSave(undo.restore); setUndo(null); }}>撤销</button>
          </div>
        )}
      </div>

      {adding && (
        <AddPropertyPopover
          anchor={adding} templates={templates} existing={existing}
          onAdd={addTemplate} onCreate={createProperty} onClose={() => setAdding(null)} saveError={saveError}
        />
      )}

      {settingsRow && settings && (
        <PropertySettingsPopover
          row={settingsRow} anchor={settings.anchor} existingKeys={rows.map((row) => row.key)}
          onDefine={(def) => defineRow(settingsRow, def)}
          onRename={(name) => { onSave(renameProp(markdown, PROPS_KEY, settingsRow.key, name)); setSettings(null); }}
          onRemove={() => removeRow(settingsRow)}
          onClose={() => setSettings(null)}
        />
      )}

      {optionRow && optionPick && (
        <OptionPicker
          row={optionRow} anchor={optionPick.anchor}
          onChange={(next) => writeCell(optionRow, next)}
          onClose={() => setOptionPick(null)}
        />
      )}
    </section>
  );
}

/** 值单元格：默认以文本呈现，点一下就地换控件；复选框与多选直接在原地操作。 */
function PropertyValue({ row, type, editing, onStartEdit, onCommit, onCancel, onPickOptions }: {
  row: PropRow;
  type: PropertyType;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (value: string | boolean | string[]) => void;
  onCancel: () => void;
  onPickOptions: (anchor: HTMLElement) => void;
}) {
  if (editing) return <ValueEditor row={row} type={type} onCommit={onCommit} onCancel={onCancel} />;

  if (type === "checkbox") {
    const on = row.raw === "true";
    return (
      <label className="mn-props-check">
        <input type="checkbox" checked={on} onChange={(event) => onCommit(event.target.checked)} />
        <span>{on ? "是" : "否"}</span>
      </label>
    );
  }

  if (type === "multiselect" || row.isArray) {
    const values = row.arrayValues;
    return (
      <span className="mn-props-chips">
        {values.map((option) => (
          <span key={option} className="mn-props-chip">
            {option}
            <button
              type="button" aria-label={`移除 ${option}`} title={`移除 ${option}`}
              onClick={() => onCommit(values.filter((entry) => entry !== option))}
            >
              <X aria-hidden />
            </button>
          </span>
        ))}
        <button
          type="button" className="mn-props-chipadd" data-panel-trigger aria-label="添加候选值" title="添加候选值"
          onClick={(event) => onPickOptions(event.currentTarget)}
        >
          <Plus aria-hidden />
        </button>
      </span>
    );
  }

  const text = row.raw.trim();
  if (type === "link" && text) {
    return (
      <span className="mn-props-link">
        <a href={text} target="_blank" rel="noreferrer">{text}</a>
        <button type="button" className="mn-props-relink" onClick={onStartEdit} title="修改链接">改</button>
      </span>
    );
  }

  return (
    <button type="button" className="mn-props-open" onClick={onStartEdit} title={text || "设置值"}>
      {text
        ? (isHttpUrl(text) ? <a href={text} target="_blank" rel="noreferrer">{text}</a> : <span>{text}</span>)
        : <span className="mn-props-emptyvalue">—</span>}
    </button>
  );
}

/** 就地控件：本地存草稿，回车 / 失焦提交，Esc 还原。 */
function ValueEditor({ row, type, onCommit, onCancel }: {
  row: PropRow;
  type: PropertyType;
  onCommit: (value: string | boolean | string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(row.raw);

  if (type === "select") {
    const options = row.def?.options ?? [];
    return (
      <select
        className="mn-props-ctrl" value={row.raw} autoFocus aria-label={row.def?.label ?? row.key}
        onChange={(event) => onCommit(event.target.value)}
        onBlur={onCancel}
      >
        <option value="">请选择…</option>
        {row.raw && !options.includes(row.raw) && <option value={row.raw}>{row.raw}（不在候选中）</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }

  if (type === "multiline") {
    return (
      <textarea
        className="mn-props-ctrl mn-props-ctrl-area" rows={3} value={text} autoFocus
        aria-label={row.def?.label ?? row.key}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => onCommit(text)}
        onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }}
      />
    );
  }

  const dateTyped = type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(row.raw);
  const numberTyped = type === "number" && /^[+-]?\d+(\.\d+)?$/.test(row.raw);
  const inputType = type === "date" && dateTyped ? "date"
    : type === "number" && numberTyped ? "number"
      : type === "link" ? "url" : "text";
  return (
    <input
      type={inputType} className="mn-props-ctrl" value={text} autoFocus
      aria-label={row.def?.label ?? row.key}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      }}
    />
  );
}

/** 多选候选：勾选即时写回，浮层不关，可以连着勾。 */
function OptionPicker({ row, anchor, onChange, onClose }: {
  row: PropRow;
  anchor: HTMLElement;
  onChange: (value: string[]) => void;
  onClose: () => void;
}) {
  const options = row.def?.options ?? [];
  const selected = row.arrayValues;
  return (
    <AnchoredPanel className="mn-proppop mn-proppop-options" anchor={anchor} align="right" label="选择候选值" onClose={onClose}>
      <p className="mn-propadd-groupname">候选值</p>
      <div className="mn-proppop-list">
        {options.length === 0 && <p className="mn-propadd-empty">这个属性还没有候选值，先在 ⋯ 里填。</p>}
        {options.map((option) => {
          const on = selected.includes(option);
          return (
            <button
              key={option} type="button" className={on ? "mn-proppop-opt on" : "mn-proppop-opt"}
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((entry) => entry !== option) : [...selected, option])}
            >
              <span className="mn-proppop-box">{on && <Check aria-hidden />}</span>
              {option}
            </button>
          );
        })}
      </div>
      <div className="mn-proppop-actions">
        <button type="button" className="mn-propbtn" onClick={onClose}>完成</button>
      </div>
    </AnchoredPanel>
  );
}
