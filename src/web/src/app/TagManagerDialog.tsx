import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "../icons";
import type { Item } from "@menote/shared";
import { removeTagFromText, renameTagInText } from "@menote/shared";
import { confirmDialog } from "../components/ui/ConfirmDialog";
import { useHomeSnapshot } from "../services/contentHooks";
import { hiddenPrivateTopicIds } from "../services/privateSpaceService";
import { saveItemContent, saveItemMeta } from "../services/contentService";
import { noteTagKey } from "../lib/noteProperties";

function matchesTag(item: Item, value: string, tag: string): boolean {
  return item.type === "note" && item.content.scope === "plain" ? noteTagKey(value) === noteTagKey(tag) : value === tag;
}

export function TagManagerDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { items, topics } = useHomeSnapshot(userId);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  // onClose 以 ref 供陷阱 effect 使用：父组件传内联箭头时，标签写库触发的 liveQuery 重渲染
  // 会生成新 onClose，若作为依赖会让陷阱 effect 反复重跑，把焦点从改名输入框拽回关闭按钮。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const hidden = hiddenPrivateTopicIds(topics);
  const visibleItems = items.filter((item) => item.topicId === null || !hidden.has(item.topicId));
  const tags = useMemo(() => [...new Set(visibleItems.flatMap((item) => item.tags))].sort((a, b) => a.localeCompare(b)), [visibleItems]);
  const withTag = (tag: string) => visibleItems.filter((item) => item.tags.some((value) => matchesTag(item, value, tag)));

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0]!; const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, []);

  const rename = async (oldTag: string) => {
    const nextTag = name.trim().replace(/^#/, "");
    if (!nextTag) { setError("标签名称不能为空。"); return; }
    if (nextTag === oldTag) { setEditing(null); setError(""); return; }
    setBusy(true); setError("");
    try {
      await Promise.all(withTag(oldTag).map((item) => renameItemTag(item, oldTag, nextTag)));
      setEditing(null);
    } catch { setError("部分条目改名未完成，请重试。"); }
    finally { setBusy(false); }
  };

  const remove = async (tag: string) => {
    const affected = withTag(tag);
    if (!await confirmDialog({ title: "移除标签", message: `从 ${affected.length} 条内容中移除 #${tag}？` })) return;
    setBusy(true); setError("");
    try {
      await Promise.all(affected.map((item) => removeItemTag(item, tag)));
    } catch { setError("部分条目移除未完成，请重试。"); }
    finally { setBusy(false); }
  };

  /** FR-MEMO-9：随记的标签住在正文里，改名/移除要改正文；普通文档仍走标签字段。 */
  const renameItemTag = async (item: Item, oldTag: string, nextTag: string) => {
    if (item.type === "memo" && item.content.scope === "plain") {
      await saveItemContent(userId, item.id, renameTagInText(item.content.markdown, oldTag, nextTag));
      return;
    }
    await saveItemMeta(userId, item.id, { tags: [...new Set(item.tags.map((tag) => matchesTag(item, tag, oldTag) ? nextTag : tag))] });
  };

  const removeItemTag = async (item: Item, tag: string) => {
    if (item.type === "memo" && item.content.scope === "plain") {
      await saveItemContent(userId, item.id, removeTagFromText(item.content.markdown, tag));
      return;
    }
    await saveItemMeta(userId, item.id, { tags: item.tags.filter((value) => !matchesTag(item, value, tag)) });
  };

  return <div className="mn-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} className="mn-dialog mn-tag-manager" role="dialog" aria-modal="true" aria-label="管理标签" tabIndex={-1}>
      <header className="mn-dialog-head"><h2 className="mn-dialog-title">管理标签</h2><button type="button" className="mn-iconbtn" aria-label="关闭" onClick={onClose}><X /></button></header>
      <div className="mn-dialog-body">
        <p className="mn-sethint">重命名或移除普通空间和随记使用的标签。私人空间标签在空间上锁期间不会显示在这里。</p>
        {error && <p className="mn-tag-manager-error" role="alert">{error}</p>}
        {tags.length === 0 ? <p className="mn-sethint">还没有可管理的标签。</p> : <ul className="mn-tag-manager-list">
          {tags.map((tag) => <li key={tag}>
            {editing === tag ? <form onSubmit={(event) => { event.preventDefault(); void rename(tag); }}>
              <input className="mn-propinput" aria-label="新标签名称" autoFocus value={name} onChange={(event) => setName(event.target.value)} disabled={busy} />
              <button type="submit" className="mn-textbtn" disabled={busy}>保存</button>
              <button type="button" className="mn-textbtn" disabled={busy} onClick={() => setEditing(null)}>取消</button>
            </form> : <><span>#{tag}</span><span className="mn-tag-manager-actions"><button type="button" className="mn-textbtn" disabled={busy} onClick={() => { setEditing(tag); setName(tag); setError(""); }}>重命名</button><button type="button" className="mn-textbtn" disabled={busy} onClick={() => void remove(tag)}>移除</button></span></>}
          </li>)}
        </ul>}
      </div>
    </section>
  </div>;
}
