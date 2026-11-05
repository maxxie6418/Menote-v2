import { useState } from "react";
import type { Item } from "@menote/shared";
import { MarkdownView } from "../markdown";
import { softDeleteItem } from "../../services/contentService";

interface ConflictCompareProps {
  userId: string;
  copy: Item;
  original: Item | undefined;
  copyText: string | null;
  onKeptOriginal: () => void;
}

/** 冲突副本与原条目并排。选一边时，另一边进回收站；两边都留则只收起对照。 */
export function ConflictCompare({ userId, copy, original, copyText, onKeptOriginal }: ConflictCompareProps) {
  const [keptBoth, setKeptBoth] = useState(false);
  const originalText = original?.content.scope === "plain" ? original.content.markdown : null;
  const originalGone = !original || original.deletedAt !== null;

  if (originalGone) return null;
  if (keptBoth) {
    return <p className="mn-conflictnote">已保留两份。这份仍是冲突副本，原条目没有删除。</p>;
  }

  const keepCopy = () => { void softDeleteItem(userId, original.id); };
  const keepOriginal = () => { void softDeleteItem(userId, copy.id).then(onKeptOriginal); };

  return (
    <section className="mn-conflict" aria-label="同步冲突对照">
      <p className="mn-conflictnote">同步冲突：下面两版都还在。选保留一份时，另一份会进回收站。</p>
      <div className="mn-conflict-grid">
        <div>
          <h3>原条目{original.title ? ` · ${original.title}` : ""}</h3>
          {originalText === null ? <p>原文已加密，解锁原条目后才能看正文。</p> : <MarkdownView markdown={originalText} className="md-body markdown-content" />}
        </div>
        <div>
          <h3>这份副本</h3>
          {copyText === null ? <p>这份还没解锁，不能对照正文。</p> : <MarkdownView markdown={copyText} className="md-body markdown-content" />}
        </div>
      </div>
      <p className="mn-conflict-actions">
        <button type="button" className="mn-btn" onClick={keepCopy}>保留这份</button>
        <button type="button" className="mn-btn" onClick={keepOriginal}>保留原条目</button>
        <button type="button" className="mn-textbtn" onClick={() => setKeptBoth(true)}>两边都留</button>
      </p>
    </section>
  );
}
