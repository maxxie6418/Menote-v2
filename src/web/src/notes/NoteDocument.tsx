/* 文档区空态：内容在选中之后显示，不做引导页（DESIGN 空状态屏）。
   阅读与编辑视图在 M2（源码）/ M3（WYSIWYG）接入。 */
export function NoteDocument({ onBack, showBack, crumb }: { onBack: () => void; showBack: boolean; crumb: string }) {
  return (
    <article className="mn-doc" aria-label="文档区">
      <div className="mn-docbar">
        <span className="mn-docbar-left">
          {showBack && (
            <button type="button" className="mn-iconbtn" aria-label="返回清单" onClick={onBack}>
              ‹
            </button>
          )}
          <span className="mn-crumb">{crumb}</span>
        </span>
      </div>
      <div className="mn-empty">
        <div>
          <p className="mn-empty-title">选择一篇，或新建</p>
          <p className="mn-empty-detail">文档区只在选中之后显示内容，不做引导页。</p>
        </div>
      </div>
    </article>
  );
}
