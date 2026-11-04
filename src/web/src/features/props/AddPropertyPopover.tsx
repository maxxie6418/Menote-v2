import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Plus, Search } from "lucide-react";
import type { PropertyDef, PropertyTemplate, PropertyType } from "../../lib/frontmatter";
import { PROPERTY_TYPES, parseOptionList } from "../../lib/frontmatter";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { TYPE_LABELS, groupTemplates } from "./propsShared";

interface AddPropertyPopoverProps {
  anchor: HTMLElement;
  templates: PropertyTemplate[];
  /** 文档里已有的键：命中的预设置灰标「已添加」，避免重复添加。 */
  existing: ReadonlySet<string>;
  onAdd: (template: PropertyTemplate) => void;
  onCreate: (name: string, def: PropertyDef, value?: string | boolean | string[]) => void;
  onClose: () => void;
}

interface Draft {
  name: string;
  label: string;
  type: PropertyType;
  options: string;
  value: string;
}

const EMPTY_DRAFT: Draft = { name: "", label: "", type: "text", options: "", value: "" };

/**
 * 添加属性浮层（FR-PROP-9）：**搜索 → 分组预设 → 新建**，一个浮层只做一件事。
 * 预设只作模板库，点一下写「定义 + 默认值」；新建表单与改定义、设置里的预设共用同一套字段语义。
 */
export function AddPropertyPopover({
  anchor, templates, existing, onAdd, onCreate, onClose,
}: AddPropertyPopoverProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const matched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return templates;
    return templates.filter((template) => (template.label ?? "").toLowerCase().includes(needle)
      || template.name.toLowerCase().includes(needle));
  }, [query, templates]);
  const groups = useMemo(() => groupTemplates(matched), [matched]);
  const addable = matched.filter((template) => !existing.has(template.name));

  const focusItem = (index: number) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-propadd-item]:not([disabled])") ?? []);
    items[index]?.focus();
  };

  const moveFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, step: 1 | -1) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-propadd-item]:not([disabled])") ?? []);
    const index = items.indexOf(event.currentTarget);
    const next = index + step;
    if (next < 0) { searchRef.current?.focus(); return; }
    if (next >= items.length) return;
    event.preventDefault();
    items[next].focus();
  };

  const startCreate = () => {
    setDraft({ ...EMPTY_DRAFT, name: query.trim() });
    setCreating(true);
    setError(null);
  };

  const submitCreate = () => {
    const name = draft.name.trim();
    if (!name) { setError("键名不能为空"); return; }
    if (existing.has(name)) { setError(`键名「${name}」已存在`); return; }
    const options = parseOptionList(draft.options);
    const needsOptions = draft.type === "select" || draft.type === "multiselect";
    if (needsOptions && options.length === 0) { setError("单选 / 多选至少要有一个候选值"); return; }
    const def: PropertyDef = {
      type: draft.type,
      ...(draft.label.trim() ? { label: draft.label.trim() } : {}),
      ...(needsOptions ? { options } : {}),
    };
    onCreate(name, def, needsOptions ? (draft.value || options[0]) : undefined);
  };

  if (creating) {
    const needsOptions = draft.type === "select" || draft.type === "multiselect";
    const options = parseOptionList(draft.options);
    return (
      <AnchoredPanel
        className="mn-proppop mn-proppop-add" anchor={anchor} align="right" label="新建属性"
        layoutKey={`create:${draft.type}:${error ?? ""}`} onClose={onClose}
      >
        <button type="button" className="mn-propadd-back" onClick={() => setCreating(false)}>← 返回预设</button>
        <div className="mn-proppop-form">
          <label className="mn-proppop-row">
            <span>键名</span>
            <input
              className="mn-propinput" value={draft.name} autoFocus placeholder="status" autoComplete="off"
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setError(null); }}
            />
          </label>
          <label className="mn-proppop-row">
            <span>显示名</span>
            <input
              className="mn-propinput" value={draft.label} placeholder="状态" autoComplete="off"
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </label>
          <label className="mn-proppop-row">
            <span>类型</span>
            <select
              className="mn-propselect" value={draft.type}
              onChange={(event) => { setDraft({ ...draft, type: event.target.value as PropertyType, value: "" }); setError(null); }}
            >
              {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
            </select>
          </label>
          {needsOptions && (
            <label className="mn-proppop-row mn-proppop-row-vert">
              <span>候选值</span>
              <textarea
                className="mn-proptextarea" rows={3} value={draft.options}
                placeholder="每行一个，或用分号、逗号分隔"
                onChange={(event) => { setDraft({ ...draft, options: event.target.value }); setError(null); }}
              />
            </label>
          )}
          {needsOptions && options.length > 0 && (
            <label className="mn-proppop-row">
              <span>默认值</span>
              <select className="mn-propselect" value={draft.value || options[0]}
                onChange={(event) => setDraft({ ...draft, value: event.target.value })}>
                {options.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          )}
          {error && <p className="mn-proppop-error" role="alert">{error}</p>}
        </div>
        <div className="mn-proppop-actions">
          <button type="button" className="mn-propbtn" onClick={() => setCreating(false)}>取消</button>
          <button type="button" className="mn-propbtn mn-propbtn-primary" onClick={submitCreate}>添加</button>
        </div>
      </AnchoredPanel>
    );
  }

  return (
    <AnchoredPanel
      className="mn-proppop mn-proppop-add" anchor={anchor} align="right" label="添加属性"
      layoutKey={query} onClose={onClose}
    >
      <div className="mn-propadd-search">
        <Search aria-hidden />
        <input
          ref={searchRef} value={query} autoFocus autoComplete="off"
          aria-label="搜索预设或输入新键名" placeholder="搜索预设，或直接输入键名"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") { event.preventDefault(); focusItem(0); }
            if (event.key === "Enter" && addable.length > 0) { event.preventDefault(); onAdd(addable[0]); }
          }}
        />
      </div>
      <div className="mn-propadd-list" ref={listRef}>
        {groups.length === 0 && (
          <p className="mn-propadd-empty">
            {templates.length === 0
              ? "还没有预设。用下面的「新建属性」，或到 设置 · 默认属性 里维护模板。"
              : "没有匹配的预设，用下面的「新建属性」。"}
          </p>
        )}
        {groups.map(({ group, items }) => (
          <div key={group} className="mn-propadd-group">
            <p className="mn-propadd-groupname">{group}</p>
            {items.map((template) => {
              const added = existing.has(template.name);
              return (
                <button
                  key={template.id} type="button" className="mn-propadd-item" data-propadd-item
                  disabled={added} title={added ? "已添加" : `添加 ${template.name}`}
                  onClick={() => onAdd(template)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") moveFocus(event, 1);
                    if (event.key === "ArrowUp") moveFocus(event, -1);
                  }}
                >
                  <span className="mn-propadd-item-main">
                    <span className="mn-propadd-item-name">{template.label ?? template.name}</span>
                    {template.label && template.label !== template.name && (
                      <span className="mn-propadd-item-key">{template.name}</span>
                    )}
                  </span>
                  <span className="mn-propadd-item-type">{added ? "已添加" : TYPE_LABELS[template.type]}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mn-propadd-foot">
        <button type="button" className="mn-propadd-new" onClick={startCreate}>
          <Plus aria-hidden />
          新建属性{query.trim() ? `「${query.trim()}」` : ""}
        </button>
      </div>
    </AnchoredPanel>
  );
}
