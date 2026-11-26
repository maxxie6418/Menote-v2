import { useRef, useState } from "react";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { Check, Plus } from "../../icons";
import { joinMultiCell, splitMultiCell } from "../../lib/gfmTable";
import type { PropertyDef } from "../../lib/frontmatter";

export function ChoicePills({ values, def, multi }: { values: string[]; def?: PropertyDef; multi: boolean }) {
  if (!values.length) return <span className="mn-tcell-empty">—</span>;
  return <span className="mn-tcell-readmulti">{values.map(value =>
    <span key={value} className={`mn-tcell-pill mn-tcell-pill-${multi ? "multi" : "single"}`}
      data-tone={def?.optionColors?.[value] ?? "neutral"} title={value}>{value}</span>)}</span>;
}

export function TableChoiceCell({ value, def, multi, onChange }: {
  value: string; def?: PropertyDef; multi: boolean; onChange: (next: string, newOption?: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = multi ? [...new Set(splitMultiCell(value))] : value ? [value] : [];
  const options = open ? [...new Set([...(def?.options ?? []), ...selected])] : [];
  const term = query.trim();
  const filtered = options.filter(option => option.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
  const exact = options.find(option => option.toLocaleLowerCase() === term.toLocaleLowerCase());
  const canCreate = Boolean(term && !exact && !term.includes(","));
  const close = () => { setOpen(false); setQuery(""); };
  const pick = (option: string, create = false) => {
    const next = multi ? joinMultiCell(selected.includes(option) ? selected.filter(tag => tag !== option) : [...selected, option]) : option;
    onChange(next, create ? option : undefined);
    setQuery("");
    if (multi) search.current?.focus();
    else { close(); trigger.current?.focus(); }
  };
  return <>
    <button ref={trigger} type="button" className={multi ? "mn-tcell-multibtn" : "mn-tcell-single-trigger"}
      aria-label={multi ? "多选单元格" : "单选单元格"} aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
      <ChoicePills values={selected} def={def} multi={multi} />
    </button>
    {open && trigger.current && <AnchoredPanel anchor={trigger.current} label={multi ? "多选标签" : "单选标签"}
      className="mn-tabledoc-hmenu mn-tcell-choice-panel" layoutKey={query + value} onClose={close}>
      <div onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); close(); trigger.current?.focus(); }
      }}>
        <input ref={search} autoFocus className="mn-tcell-search" placeholder="查找或新建标签" aria-label="查找或新建标签"
          value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.key !== "Enter") return;
            event.preventDefault();
            if (exact) pick(exact);
            else if (canCreate) pick(term, true);
            else if (filtered[0]) pick(filtered[0]);
          }} />
        {filtered.map(option => <button key={option} type="button" className="mn-tcell-pickrow" aria-pressed={selected.includes(option)}
          onClick={() => pick(option)}><ChoicePills values={[option]} def={def} multi={multi} />
          {selected.includes(option) && <Check aria-hidden="true" />}</button>)}
        {canCreate && <button type="button" className="mn-tcell-pickrow" onClick={() => pick(term, true)}><Plus aria-hidden="true" />创建「{term}」</button>}
        {term.includes(",") && !exact && <span className="mn-tcell-pophint">标签名不能含英文逗号</span>}
        {!multi && value && <button type="button" className="mn-tcell-pickrow" onClick={() => pick("")}>清除选择</button>}
      </div>
    </AnchoredPanel>}
  </>;
}
