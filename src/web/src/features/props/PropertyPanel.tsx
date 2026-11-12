import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, MoreHorizontal, Plus, X } from "../../icons";
import type { PropRow, PropertyDef, PropertyTemplate, PropertyType } from "../../lib/frontmatter";
import {
  PROPS_KEY, readPropRows, removePropDef, renameProp, restoreProp, writeDef, writeValue,
} from "../../lib/frontmatter";
import { readPropertyTemplates, DEFAULT_PROPERTY_TEMPLATES } from "../../services/propertyTemplateService";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { AddPropertyPopover } from "./AddPropertyPopover";
import { PropertySettingsPopover } from "./PropertySettingsPopover";
import {
  GRID_MULTI_PAIR_MAX, PROPS_TWO_COLUMN_MIN, STRIP_LEFT_TYPES, STRIP_RIGHT_TYPES,
  inferType, isBlankValue, isHttpUrl, isStripRow,
} from "./propsShared";

interface PropertyPanelProps {
  markdown: string;
  userId: string;
  /** 写回经统一文档更新链路（FR-PROP-3）：产出新 markdown，由上层走 saveItemContent 保存。 */
  onSave: (next: string) => Promise<boolean> | boolean | void;
}

/**
 * 属性区（FR-PROP-1/2/9/10）。2026-11-12 按负责人确认的 C 方案重排为三个区：
 *
 * · 区一「一排」：长度可预测、点开即改的高频字段。左组放判定（单选、复选框），
 *   右组放归属（作者/来源、日期、数值），两端分布，中间是弹性空白；
 *   右组放不下时按实测宽度收进 ⋯N（不写死数量，窄栏自动降级）。
 * · 区二「两列」：长短不定的多选两两并排，落单跨满；长字段一律跨满，禁止半格空洞。
 * · 区三「概述」：多行文本固定两行高度，内容长短不改变块高。
 *
 * 缺省规则（负责人要求「固定成规则」）：带是摘要，空值整项不出现；
 * 网格是清单，定义过就留一行淡破折。纯带内类型（单选 / 复选框）没有值时不渲染，
 * 因为它们在网格里没有可读的「空」形态。
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
  const [undo, setUndo] = useState<{ text: string; key: string; previousMarkdown: string } | null>(null);
  const [columns, setColumns] = useState<1 | 2>(2);
  /** 带内就地编辑：锚点是被点的那一枚胶囊 / 日期 / 文本。 */
  const [slotEdit, setSlotEdit] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  /** 带右组被收起那些项的列表浮层。 */
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  /** 右组当前显示几项：由实测宽度决定，渲染后回填。 */
  const [visibleRight, setVisibleRight] = useState(99);

  const sectionRef = useRef<HTMLElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  /* 单列 / 双列看「文档栏宽」而不是窗口宽度：ResizeObserver 盯住属性区自身 */
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

  /**
   * 显示名回落（FR-PROP-9）：文档里的属性没有定义（典型：剪藏管线只写值键）或定义里没写
   * 显示名时，按键名查预设——用户预设优先，出厂预设兜底；都查不到才露出键名。
   * 只影响展示，不回写文档。
   */
  const presetLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const template of [...DEFAULT_PROPERTY_TEMPLATES, ...templates]) {
      if (template.label && !map.has(template.name)) map.set(template.name, template.label);
    }
    return map;
  }, [templates]);
  const labelOf = (row: PropRow): string => row.def?.label ?? presetLabels.get(row.key) ?? row.key;

  /**
   * 三区分拣。空值在这里分流：纯带内类型（单选 / 复选框）无处可放，直接不进渲染；
   * 其余空值落网格，保留一行破折（多选显示「+ 添加」），行位置不跳。
   */
  const groups = useMemo(() => {
    const left: PropRow[] = [];
    const right: PropRow[] = [];
    const multi: PropRow[] = [];
    const long: PropRow[] = [];
    for (const row of rows) {
      const type = row.def?.type ?? inferType(row);
      if (isBlankValue(row)) {
        if (type === "select" || type === "checkbox") continue;
        if (type === "multiselect" || row.isArray) multi.push(row);
        else long.push(row);
        continue;
      }
      if (STRIP_LEFT_TYPES.has(type)) { left.push(row); continue; }
      if (STRIP_RIGHT_TYPES.has(type) && isStripRow(row, type)) { right.push(row); continue; }
      if (type === "multiselect" || row.isArray) { multi.push(row); continue; }
      long.push(row);
    }
    return { left, right, multi, long };
  }, [rows]);

  /** 网格单元格：多选两两配对（≤2 项），落单跨满；项数多的与长字段一律跨满。 */
  const cells = useMemo(() => {
    const out: Array<{ row: PropRow; span: boolean; second: boolean }> = [];
    const halfable = groups.multi.filter((row) => row.arrayValues.length <= GRID_MULTI_PAIR_MAX);
    const wide = groups.multi.filter((row) => row.arrayValues.length > GRID_MULTI_PAIR_MAX);
    for (let i = 0; i < halfable.length; i += 2) {
      const first = halfable[i];
      const second = halfable[i + 1];
      if (second) {
        out.push({ row: first, span: false, second: false }, { row: second, span: false, second: true });
      } else {
        out.push({ row: first, span: true, second: false });   // 落单跨满，不留半格空洞
      }
    }
    for (const row of wide) out.push({ row, span: true, second: false });
    for (const row of groups.long) out.push({ row, span: true, second: false });
    return out;
  }, [groups]);

  /**
   * 带右组显示几项：全部铺开后逐枚量宽，放不下的收进 ⋯N。
   * 量之前先临时撤掉 is-hidden（useLayoutEffect 内、paint 之前，不会闪）；
   * 结果与当前一致就不 setState，避免 ResizeObserver 自激。
   */
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const right = rightRef.current;
    if (!strip || !right || typeof ResizeObserver === "undefined") return;

    const fit = () => {
      const slots = Array.from(right.querySelectorAll<HTMLElement>("[data-slot]"));
      if (!slots.length) { setVisibleRight(99); return; }
      slots.forEach((slot) => slot.classList.remove("is-hidden"));
      const available = strip.clientWidth;
      const leftWidth = leftRef.current?.offsetWidth ?? 0;
      const base = leftWidth > 0 ? leftWidth + 20 : 0;
      const widths = slots.map((slot) => slot.offsetWidth);
      const gap = 16;

      let count = 0;
      let used = base;
      for (let i = 0; i < widths.length; i += 1) {
        const step = widths[i] + (i > 0 ? gap : 0);
        if (used + step > available) break;
        used += step;
        count += 1;
      }
      /* 有被收起的项时，末尾还要让出 ⋯N 的位置 */
      if (count < widths.length) {
        const reserve = 48;
        used = base;
        count = 0;
        for (let i = 0; i < widths.length; i += 1) {
          const step = widths[i] + (i > 0 ? gap : 0);
          if (used + step + reserve > available) break;
          used += step;
          count += 1;
        }
      }
      setVisibleRight((current) => (current === count ? current : count));
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [groups.right, columns]);   /* 值变长变短也要重测，不能只看项数 */

  /* 属性被删掉后 visibleRight 可能大于剩余项数，渲染时按实际长度截断 */
  const shownRight = Math.min(visibleRight, groups.right.length);
  const hiddenRight = groups.right.slice(shownRight);

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
    onSave(removePropDef(markdown, PROPS_KEY, row.key));
    setSettings(null);
    setUndo({ text: `已删除「${labelOf(row)}」`, key: row.key, previousMarkdown: markdown });
  };

  const settingsRow = settings ? rows.find((row) => row.key === settings.key) ?? null : null;
  const optionRow = optionPick ? rows.find((row) => row.key === optionPick.key) ?? null : null;
  const slotRow = slotEdit ? rows.find((row) => row.key === slotEdit.key) ?? null : null;
  const hasAnyCell = groups.left.length > 0 || groups.right.length > 0 || cells.length > 0;

  const openSlotEdit = (row: PropRow, anchor: HTMLElement) => {
    setSettings(null);
    setEditing(null);
    setMoreAnchor(null);
    setSlotEdit({ key: row.key, anchor });
  };

  const renderRow = (row: PropRow, span: boolean, second: boolean) => {
    const type = row.def?.type ?? inferType(row);
    const label = labelOf(row);
    const classes = [
      "mn-props-row",
      span ? "is-span" : "is-half",
      second ? "is-second" : "",
      type === "multiline" ? "is-multiline" : "",
      flash === row.key ? "is-flash" : "",
    ].filter(Boolean).join(" ");
    return (
      <div key={row.key} className={classes}>
        <span className="mn-props-key" title={row.key}>{label}</span>
        <div className="mn-props-value">
          <PropertyValue
            row={row} type={type} label={label} editing={editing === row.key}
            onStartEdit={() => { setEditing(row.key); setSettings(null); }}
            onCommit={(value) => { setEditing(null); writeCell(row, value); }}
            onCancel={() => setEditing(null)}
            onPickOptions={(anchor) => setOptionPick({ key: row.key, anchor })}
          />
        </div>
        <button
          type="button" className="mn-props-more" data-panel-trigger
          aria-expanded={settings?.key === row.key} aria-label={`属性设置：${label}`}
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
    );
  };

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

      {/* 区一：带。左右都空就不渲染，连底线一起（否则只剩一条空线） */}
      {(groups.left.length > 0 || groups.right.length > 0) && (
        <div className="mn-props-strip" data-alone={groups.left.length ? "0" : "1"} ref={stripRef}>
          <div className="mn-strip-left" ref={leftRef}>
            {groups.left.map((row) => {
              const type = row.def?.type ?? inferType(row);
              const label = labelOf(row);
              return (
                <span key={row.key} data-slot className={`mn-strip-slot${flash === row.key ? " is-flash" : ""}`}>
                  <StripSlot
                    row={row} type={type} label={label}
                    onEdit={(anchor) => openSlotEdit(row, anchor)}
                    onToggle={(next) => writeCell(row, next)}
                  />
                </span>
              );
            })}
          </div>
          <div className="mn-strip-right" ref={rightRef}>
            {groups.right.map((row, index) => {
              const type = row.def?.type ?? inferType(row);
              const label = labelOf(row);
              return (
                <span
                  key={row.key} data-slot
                  className={`mn-strip-slot${index >= shownRight ? " is-hidden" : ""}${flash === row.key ? " is-flash" : ""}`}
                >
                  <StripSlot
                    row={row} type={type} label={label}
                    onEdit={(anchor) => openSlotEdit(row, anchor)}
                    onToggle={(next) => writeCell(row, next)}
                  />
                </span>
              );
            })}
            {hiddenRight.length > 0 && (
              <button
                type="button" className="mn-strip-more" data-panel-trigger
                aria-expanded={moreAnchor !== null} title={`还有 ${hiddenRight.length} 项`}
                onClick={(event) => {
                  const anchor = event.currentTarget;
                  setSlotEdit(null);
                  setMoreAnchor((current) => (current ? null : anchor));
                }}
              >
                ⋯{hiddenRight.length}
              </button>
            )}
          </div>
        </div>
      )}

      {/* 区二 + 区三：网格。多选两两并排或跨满，长字段跨满，多行文本固定两行 */}
      {cells.length > 0 && (
        <div className="mn-props-grid">
          {cells.map((cell) => renderRow(cell.row, cell.span, cell.second))}
        </div>
      )}

      {!hasAnyCell && (
        <button type="button" className="mn-props-empty" data-panel-trigger onClick={(event) => setAdding(event.currentTarget)}>
          <Plus aria-hidden />{rows.length === 0 ? "添加属性" : "属性都还没有值，点这里补一个"}
        </button>
      )}

      {undo && (
        <div className="mn-props-undo" role="status">
          <span>{undo.text}</span>
          <button type="button" onClick={() => { onSave(restoreProp(markdown, undo.previousMarkdown, PROPS_KEY, undo.key)); setUndo(null); }}>撤销</button>
        </div>
      )}

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

      {slotRow && slotEdit && (
        <AnchoredPanel
          className="mn-proppop mn-proppop-edit" anchor={slotEdit.anchor} align="right"
          label={`编辑${labelOf(slotRow)}`} onClose={() => setSlotEdit(null)}
        >
          <div className="mn-proppop-form">
            <p className="mn-proppop-title">{labelOf(slotRow)}</p>
            <ValueEditor
              row={slotRow} type={slotRow.def?.type ?? inferType(slotRow)} label={labelOf(slotRow)}
              onCommit={(value) => { setSlotEdit(null); writeCell(slotRow, value); }}
              onCancel={() => setSlotEdit(null)}
            />
          </div>
        </AnchoredPanel>
      )}

      {moreAnchor && hiddenRight.length > 0 && (
        <AnchoredPanel
          className="mn-proppop mn-proppop-more" anchor={moreAnchor} align="right"
          label="收起的属性" onClose={() => setMoreAnchor(null)}
        >
          <p className="mn-propadd-groupname">收起的 {hiddenRight.length} 项</p>
          <div className="mn-proppop-list">
            {hiddenRight.map((row) => (
              <button
                key={row.key} type="button" className="mn-proppop-opt"
                onClick={(event) => openSlotEdit(row, event.currentTarget)}
              >
                <span className="mn-striplist-key">{labelOf(row)}</span>
                <span className="mn-striplist-value">{row.raw}</span>
              </button>
            ))}
          </div>
        </AnchoredPanel>
      )}
    </section>
  );
}

/** 带内一枚：判定类给胶囊 / 徽标，归属类给「键 值」或纯文本；点击都进就地编辑。 */
function StripSlot({ row, type, label, onEdit, onToggle }: {
  row: PropRow;
  type: PropertyType;
  label: string;
  onEdit: (anchor: HTMLElement) => void;
  onToggle: (next: boolean) => void;
}) {
  if (type === "checkbox") {
    const on = row.raw === "true";
    return (
      <button
        type="button" className="mn-strip-flag" aria-pressed={on}
        title={`${label}：${on ? "是" : "否"}`}
        onClick={() => onToggle(!on)}
      >
        <Check aria-hidden />{label}
      </button>
    );
  }
  if (type === "select") {
    return (
      <button type="button" className="mn-strip-pill" title={`${label}：${row.raw}`} onClick={(event) => onEdit(event.currentTarget)}>
        <i aria-hidden />{row.raw}
      </button>
    );
  }
  if (type === "date" || type === "number") {
    return (
      <button type="button" className="mn-strip-stamp" title={`${label}：${row.raw}`} onClick={(event) => onEdit(event.currentTarget)}>
        <b>{label}</b><span>{row.raw}</span>
      </button>
    );
  }
  return (
    <button type="button" className="mn-strip-text" title={`${label}：${row.raw}`} onClick={(event) => onEdit(event.currentTarget)}>
      {row.raw}
    </button>
  );
}

/** 值单元格：默认以文本呈现，点一下就地换控件；复选框与多选直接在原地操作。 */
function PropertyValue({ row, type, label, editing, onStartEdit, onCommit, onCancel, onPickOptions }: {
  row: PropRow;
  type: PropertyType;
  /** 展示用显示名（含预设回落），只作无障碍标签。 */
  label: string;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (value: string | boolean | string[]) => void;
  onCancel: () => void;
  onPickOptions: (anchor: HTMLElement) => void;
}) {
  if (editing) return <ValueEditor row={row} type={type} label={label} onCommit={onCommit} onCancel={onCancel} />;

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

  if (text && isHttpUrl(text)) {
    return (
      <span className="mn-props-link">
        <a href={text} target="_blank" rel="noreferrer">{text}</a>
        <button type="button" className="mn-props-relink" onClick={onStartEdit} title="修改值">改</button>
      </span>
    );
  }

  return (
    <button type="button" className="mn-props-open" onClick={onStartEdit} title={text || "设置值"}>
      {text ? <span>{text}</span> : <span className="mn-props-emptyvalue">—</span>}
    </button>
  );
}

/** 就地控件：本地存草稿，回车 / 失焦提交，Esc 还原。 */
function ValueEditor({ row, type, label, onCommit, onCancel }: {
  row: PropRow;
  type: PropertyType;
  label: string;
  onCommit: (value: string | boolean | string[]) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(row.raw);

  if (type === "select") {
    const options = row.def?.options ?? [];
    return (
      <select
        className="mn-props-ctrl" value={row.raw} autoFocus aria-label={label}
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
        aria-label={label}
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
      aria-label={label}
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
