import { useEffect, useState, type RefObject } from "react";
import { ListTree } from "../../icons";

interface OutlineEntry { level: number; text: string; index: number }

const HEADINGS = ":is(h1, h2, h3, h4, h5, h6)";

function fromSource(value: string): OutlineEntry[] {
  let fence: string | null = null;
  return value.split("\n").flatMap((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      const char = marker[1]![0]!;
      fence = fence === char ? null : fence ?? char;
      return [];
    }
    if (fence) return [];
    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match ? [{ level: match[1]!.length, text: match[2]!, index }] : [];
  });
}

export function OutlinePanel({ hostRef, kind, variant = "popover", onNavigate }: { hostRef: RefObject<HTMLDivElement | null>; kind: "wysiwyg" | "source" | "preview"; variant?: "popover" | "inspector"; onNavigate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<OutlineEntry[]>([]);
  const headingSelector = kind === "preview" ? HEADINGS : `.ProseMirror ${HEADINGS}`;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      if (kind === "source") {
        const textarea = host.querySelector("textarea");
        setEntries(textarea ? fromSource(textarea.value) : []);
        return;
      }
      const headings = [...host.querySelectorAll<HTMLElement>(headingSelector)];
      setEntries(headings.map((heading, index) => ({ level: Number(heading.tagName.slice(1)), text: heading.innerText.trim(), index })).filter((entry) => entry.text));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(host, { subtree: true, childList: true, characterData: true });
    host.addEventListener("input", update);
    return () => { observer.disconnect(); host.removeEventListener("input", update); };
  }, [hostRef, kind, headingSelector]);

  const goTo = (entry: OutlineEntry) => {
    const host = hostRef.current;
    if (!host) return;
    if (kind === "source") {
      const textarea = host.querySelector("textarea");
      if (!textarea) return;
      const start = textarea.value.split("\n").slice(0, entry.index).reduce((sum, line) => sum + line.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(start, start);
      onNavigate?.();
      return;
    }
    const heading = host.querySelectorAll<HTMLElement>(headingSelector)[entry.index];
    if (!heading) return;
    heading.scrollIntoView({ behavior: "smooth", block: "start" });
    onNavigate?.();
  };

  if (variant === "inspector") return <section className="mn-inspector-section mn-inspector-outline" aria-label="文档大纲">
    <nav className="mn-outline-inspector">
      {entries.length === 0 ? <p className="mn-outline-empty">添加标题后会显示在这里</p> : entries.map((entry) => <button key={`${entry.index}-${entry.text}`} type="button" className="mn-outline-entry" data-level={entry.level} onClick={() => goTo(entry)}>{entry.text}</button>)}
    </nav>
  </section>;

  return <div className="mn-outline-control">
    <button type="button" className="mn-iconbtn" aria-label="文档大纲" title="文档大纲" aria-expanded={open} onClick={() => setOpen((value) => !value)}><ListTree aria-hidden="true" /></button>
    {open && <nav className="mn-outline" aria-label="文档大纲">
      <div className="mn-outline-title">大纲</div>
      {entries.length === 0 ? <p className="mn-outline-empty">添加标题后会显示在这里</p> : entries.map((entry) => <button key={`${entry.index}-${entry.text}`} type="button" className="mn-outline-entry" data-level={entry.level} onClick={() => goTo(entry)}>{entry.text}</button>)}
    </nav>}
  </div>;
}
