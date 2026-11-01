import { useEffect, useState } from "react";
import { createMemo } from "../../services/contentService";

/** Memo 快速输入（FR-IA-5）：默认单行，点击展开多行，占共享区域不推移导航；
 *  保存后留在当前页；收起保留未完成草稿。 */
export function QuickComposer({ userId, openSignal = 0 }: { userId: string; openSignal?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (openSignal > 0) setExpanded(true);
  }, [openSignal]);

  const submit = async () => {
    const text = value.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await createMemo(userId, text);
      setValue("");
      setExpanded(false);
    } finally {
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <button type="button" className="mn-memo-hint" onClick={() => setExpanded(true)}>
        <span className="mn-dot" aria-hidden="true" />
        <span>记一条 Memo…</span>
        <span className="mn-kbd">⌘↵</span>
      </button>
    );
  }

  return (
    <div className="mn-composer">
      <textarea
        className="mn-composer-input" autoFocus rows={expanded ? 3 : 1}
        placeholder="记一条 Memo…（⌘/Ctrl+Enter 保存，Esc 收起）"
        aria-label="Memo 快速输入"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void submit(); }
          if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
        }}
      />
      <div className="mn-composer-actions">
        <button type="button" className="mn-minibtn" onClick={() => setExpanded(false)}>收起</button>
        <button type="button" className="mn-minibtn" disabled={busy} aria-disabled={busy} onClick={() => void submit()}>
          保存
        </button>
      </div>
    </div>
  );
}
