import { useState } from "react";
import type { PropRow, PropertyDef, PropertyType } from "../../lib/frontmatter";
import { PROPERTY_TYPES, parseOptionList } from "../../lib/frontmatter";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { TYPE_LABELS, inferType, keptDef, type PropPlacement } from "./propsShared";

interface PropertySettingsPopoverProps {
  row: PropRow;
  anchor: HTMLElement;
  /** 文档里已有的键（重命名查重用）。 */
  existingKeys: string[];
  /** 当前生效的显示位置（第一排 / 并列 / 独享整排）。 */
  placement: PropPlacement;
  onPlacement: (placement: PropPlacement) => void;
  onDefine: (def: PropertyDef) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * 属性设置浮层（FR-PROP-2）：值在行内改，**定义只在这里改**。
 * 改动即时写回——没有「保存 / 完成」，也就不存在「我到底存没存」。
 * 单选 / 多选没有候选值时先不落类型（FR-PROP-5 要求候选显式定义），
 * 就地提示并等候选值填好再一起写。
 */
export function PropertySettingsPopover({
  row, anchor, existingKeys, placement, onPlacement, onDefine, onRename, onRemove, onClose,
}: PropertySettingsPopoverProps) {
  const currentType = row.def?.type ?? inferType(row);
  const [type, setType] = useState<PropertyType>(currentType);
  const [name, setName] = useState(row.key);
  const [label, setLabel] = useState(row.def?.label ?? "");
  const [optionsText, setOptionsText] = useState((row.def?.options ?? row.arrayValues).join("\n"));
  const [error, setError] = useState<string | null>(null);

  const needsOptions = type === "select" || type === "multiselect";
  const pendingOptions = needsOptions && parseOptionList(optionsText).length === 0;

  const commitType = (next: PropertyType) => {
    setType(next);
    setError(null);
    if ((next === "select" || next === "multiselect") && parseOptionList(optionsText).length === 0) return;
    onDefine(keptDef(row, next, next === "select" || next === "multiselect" ? parseOptionList(optionsText) : undefined));
  };

  const commitOptions = () => {
    const options = parseOptionList(optionsText);
    if (!options.length) return;
    onDefine(keptDef(row, type, options));
  };

  const commitLabel = () => {
    const next = label.trim();
    if (next === (row.def?.label ?? "")) return;
    onDefine({
      type,
      ...(next ? { label: next } : {}),
      ...(needsOptions && !pendingOptions ? { options: parseOptionList(optionsText) } : {}),
      ...(typeof row.def?.strip === "boolean" ? { strip: row.def.strip } : {}),
      ...(typeof row.def?.wide === "boolean" ? { wide: row.def.wide } : {}),
    });
  };

  const commitName = () => {
    const next = name.trim();
    if (!next || next === row.key) { setName(row.key); return; }
    if (existingKeys.includes(next)) { setError(`键名「${next}」已存在`); return; }
    onRename(next);
  };

  return (
    <AnchoredPanel
      className="mn-proppop" anchor={anchor} align="right" label={`属性设置：${row.def?.label ?? row.key}`}
      layoutKey={`${type}:${pendingOptions}:${error ?? ""}`} onClose={onClose}
    >
      <div className="mn-proppop-form">
        <label className="mn-proppop-row">
          <span>键名</span>
          <input
            className="mn-propinput" value={name} autoComplete="off"
            onChange={(event) => { setName(event.target.value); setError(null); }}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
              if (event.key === "Escape") { event.preventDefault(); setName(row.key); event.currentTarget.blur(); }
            }}
          />
        </label>
        <label className="mn-proppop-row">
          <span>显示名</span>
          <input
            className="mn-propinput" value={label} placeholder="可选" autoComplete="off"
            onChange={(event) => setLabel(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}
          />
        </label>
        <label className="mn-proppop-row">
          <span>类型</span>
          <select
            className="mn-propselect" aria-label={`${row.key} 的类型`} value={type}
            onChange={(event) => commitType(event.target.value as PropertyType)}
          >
            {PROPERTY_TYPES.map((option) => <option key={option} value={option}>{TYPE_LABELS[option]}</option>)}
          </select>
        </label>
        <label className="mn-proppop-row">
          <span>位置</span>
          <select
            className="mn-propselect" aria-label={`${row.key} 的显示位置`} value={placement}
            onChange={(event) => onPlacement(event.target.value as PropPlacement)}
          >
            <option value="strip">第一排 · 一行摘要</option>
            <option value="pair">并列 · 两两成对</option>
            <option value="wide">独享整排 · 两行</option>
          </select>
        </label>
        {needsOptions && (
          <label className="mn-proppop-row mn-proppop-row-vert">
            <span>候选值</span>
            <textarea
              className="mn-proptextarea" rows={3} value={optionsText}
              placeholder="每行一个，或用分号、逗号分隔"
              aria-label={`${row.key} 的候选值`}
              onChange={(event) => setOptionsText(event.target.value)}
              onBlur={commitOptions}
            />
          </label>
        )}
        {(pendingOptions || error) && (
          <p className="mn-proppop-error" role="alert">
            {error ?? "单选 / 多选至少要有一个候选值，填好即生效"}
          </p>
        )}
      </div>
      <div className="mn-proppop-danger">
        <button type="button" onClick={onRemove}>删除属性</button>
      </div>
    </AnchoredPanel>
  );
}
