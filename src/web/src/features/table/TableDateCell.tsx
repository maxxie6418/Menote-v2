import { useRef, useState } from "react";
import { AnchoredPanel } from "../../components/ui/AnchoredPanel";
import { Calendar, Clock } from "../../icons";
import { parseTableDate } from "./tableFieldValues";

export function TableDateCell({ value, dateTime, onChange }: { value: string; dateTime: boolean; onChange?: (value: string) => void }) {
  const parsed = parseTableDate(value);
  const withTime = dateTime || Boolean(parsed?.time);
  const trigger = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const legacy = Boolean(value && !parsed);
  // datetime-local 支持毫秒；原文更细的精度留给写回时复用。
  const seconds = parsed?.seconds ?? "";
  const inputSeconds = seconds.slice(0, 7);
  const initial = parsed?.time ? parsed.day + "T" + parsed.time + inputSeconds : parsed?.day ?? value;
  const dateOnly = Boolean(parsed && !parsed.time);
  const inputValue = withTime && dateOnly ? initial + "T00:00" : initial;
  const Icon = withTime ? Clock : Calendar;
  const zone = parsed?.zone === "Z" ? "UTC" : parsed?.zone ? "UTC" + parsed.zone : "";
  const shortZone = parsed?.zone && parsed.zone !== "Z" ? parsed.zone.replace(/:00$/, "") : zone;
  const label = withTime ? "日期时间" : "日期";
  const content = <><Icon aria-hidden="true" />{parsed ? <time dateTime={value} title={value}>
    {parsed.day.replaceAll("-", "/")}{parsed.time && <span className="mn-tcell-clock">{parsed.time}{seconds.slice(0, 3) !== ":00" ? seconds.slice(0, 3) : ""}{zone && <small title={zone}>{shortZone}</small>}</span>}
  </time> : <span className={value ? "mn-tcell-legacy" : "mn-tcell-empty"}>{value || "—"}</span>}</>;
  if (!onChange) return <span className="mn-tcell-temporal">{content}</span>;
  const finish = (next?: string) => {
    if (next !== undefined && next !== value) onChange(next);
    setDraft(null);
    trigger.current?.focus();
  };
  return <>
    <button ref={trigger} type="button" className="mn-tcell-temporal" aria-label={label + "单元格"} title={value || "选择" + label}
      aria-expanded={draft !== null} onClick={() => setDraft(draft === null ? inputValue : null)}>{content}</button>
    {draft !== null && trigger.current && <AnchoredPanel anchor={trigger.current} label={"编辑" + label} className="mn-tabledoc-hmenu"
      onClose={() => setDraft(null)}>
      <form className="mn-tcell-date-form" onSubmit={event => {
        event.preventDefault();
        if (draft === inputValue) finish();
        else if (legacy || !withTime || !draft) finish(draft);
        else {
          const edited = parseTableDate(draft);
          if (!edited?.time) return;
          const sameSeconds = Number((edited.seconds || ":00").slice(1)) === Number((inputSeconds || ":00").slice(1));
          finish(edited.day + "T" + edited.time + (sameSeconds ? seconds : edited.seconds) + (parsed?.zone ?? ""));
        }
      }} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); finish(); } }}>
        <label>{label}{zone && " · " + zone}
          <input autoFocus aria-label={"编辑" + label} type={legacy ? "text" : withTime ? "datetime-local" : "date"} step={withTime ? "any" : undefined}
            value={draft} onChange={event => setDraft(event.target.value)} /></label>
        <div className="mn-tcell-date-actions"><button type="button" className="mn-textbtn" onClick={() => finish("")}>清除</button>
          <button type="submit" className="mn-auth-submit">保存</button></div>
      </form>
    </AnchoredPanel>}
  </>;
}
