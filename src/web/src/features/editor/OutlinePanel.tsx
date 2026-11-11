import { useEffect, useState, type RefObject } from "react";
import { ListTree } from "../../icons";

interface OutlineEntry { level: number; text: string; index: number }

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

export function OutlinePanel({ hostRef, kind, variant = "popover", markdown }: { hostRef: RefObject<HTMLDivElement | null>; kind: "wysiwyg" | "source"; variant?: "popover" | "inspector"; markdown?: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<OutlineEntry[]>([]);

  useEffect(() => {
    if (markdown !== undefined) { setEntries(fromSource(markdown)); return; }
    const host = hostRef.current;
    if (!host) return;
    const update = () => {
      if (kind === "source") {
        const textarea = host.querySelector("textarea");
        setEntries(textarea ? fromSource(textarea.value) : []);
        return;
      }
      const headings = [...host.querySelectorAll<HTMLElement>(".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6")];
      setEntries(headings.map((heading, index) => ({ level: Number(heading.tagName.slice(1)), text: heading.innerText.trim(), index })).filter((entry) => entry.text));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(host, { subtree: true, childList: true, characterData: true });
    host.addEventListener("input", update);
    return () => { observer.disconnect(); host.removeEventListener("input", update); };
  }, [hostRef, kind, markdown]);

  const goTo = (entry: OutlineEntry) => {
    const host = hostRef.current;
    if (!host) {
      if (markdown !== undefined) {
        const headings = document.querySelectorAll<HTMLElement>(".mn-doc[data-form='note'] .mn-doc-preview h1, .mn-doc[data-form='note'] .mn-doc-preview h2, .mn-doc[data-form='note'] .mn-doc-preview h3, .mn-doc[data-form='note'] .mn-doc-preview h4, .mn-doc[data-form='note'] .mn-doc-preview h5, .mn-doc[data-form='note'] .mn-doc-preview h6");
        headings[entry.index]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (kind === "source") {
      const textarea = host.querySelector("textarea");
      if (!textarea) return;
      const start = textarea.value.split("\n").slice(0, entry.index).reduce((sum, line) => sum + line.length + 1, 0);
      textarea.focus();
      textarea.setSelectionRange(start, start);
      return;
    }
    const headings = host.querySelectorAll<HTMLElement>(".ProseMirror h1, .ProseMirror h2, .ProseMirror h3, .ProseMirror h4, .ProseMirror h5, .ProseMirror h6");
    headings[entry.index]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (variant === "inspector") return <section className="mn-inspector-section mn-inspector-outline" aria-label="文档大纲">
    <header className="mn-inspector-section-head"><h2>大纲</h2><span>{entries.length} 节</span></header>
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
