import { MoreHorizontal } from "lucide-react";
import type { DemoDocument, DemoNote } from "../lib/demoData";
import { demoDocument, demoEmptyState } from "../lib/demoData";

interface NoteDocumentProps {
  note: DemoNote | null;
  onBack: () => void;
  showBack: boolean;
}

/* 文档阅读区：属性行与正文均为演示内容；编辑器（M2 源码形态 / M3 WYSIWYG）未接入，
   模式切换不提供可用编辑。 */
export function NoteDocument({ note, onBack, showBack }: NoteDocumentProps) {
  if (!note) {
    return (
      <article className="mn-doc" aria-label="文档区">
        <div className="mn-docbar">
          <span className="mn-crumb">{demoEmptyState.docTitle}</span>
        </div>
        <div className="mn-empty">
          <div>
            <p className="mn-empty-title">{demoEmptyState.docTitle}</p>
            <p className="mn-empty-detail">{demoEmptyState.docDetail}</p>
          </div>
        </div>
      </article>
    );
  }
  return (
    <article className="mn-doc" aria-label="文档阅读区">
      <div className="mn-docbar">
        <span className="mn-docbar-left">
          {showBack && (
            <button type="button" className="mn-iconbtn" aria-label="返回清单" onClick={onBack}>
              ‹
            </button>
          )}
          <span className="mn-crumb">{demoDocument.crumb}</span>
        </span>
        <span className="mn-bar-r">
          <span className="mn-modes" role="group" aria-label="查看模式">
            <span aria-disabled="true" title="编辑器将在 M2（源码）/ M3（所见即所得）开放">编辑</span>
            <span className="on">预览</span>
          </span>
          <button type="button" className="mn-iconbtn" aria-disabled="true" title="更多操作将在 M2 开放" aria-label="更多操作（未开放）">
            <MoreHorizontal />
          </button>
        </span>
      </div>
      <div className="mn-docin">
        <div className="mn-kicker">
          <span>{demoDocument.kicker}</span>
        </div>
        <h1 className="mn-doctitle">{note.title}</h1>
        <div className="mn-props">
          <div className="mn-prop"><span className="mn-prop-k">状态</span><span className="mn-prop-v"><span className="mn-pill">{demoDocument.status}</span></span></div>
          <div className="mn-prop"><span className="mn-prop-k">更新</span><span className="mn-prop-v">{demoDocument.updated}</span></div>
          <div className="mn-prop"><span className="mn-prop-k">标签</span><span className="mn-prop-v">{demoDocument.tags.map((tag) => <span key={tag} className="mn-tc">{tag}</span>)}</span></div>
          <div className="mn-prop"><span className="mn-prop-k">来源</span><span className="mn-prop-v"><a className="mn-lnk" href="#" onClick={(event) => event.preventDefault()}>{demoDocument.source}</a></span></div>
        </div>
        <DemoProse />
      </div>
      <div className="mn-docfoot">
        <span>演示内容 · Markdown</span>
        <span>{demoDocument.wordCount}</span>
      </div>
    </article>
  );
}

/* 演示正文：静态 JSX 示例，样式走 markdown-content（--md-* 渲染 tokens）。 */
function DemoProse() {
  return (
    <div className="markdown-content mn-prose">
      <h2>一、分层原则</h2>
      <p>材质不靠单张贴图堆细节。基础层只负责底色与粗糙度，细节层用平铺遮罩控制磨损位置，混合层解决边缘过渡——三层各自可替换，改一处不会全盘崩。</p>
      <ul>
        <li>基础层：底色 + 粗糙度，命名 <code>M_&lt;角色&gt;_Base</code></li>
        <li>细节层：平铺遮罩，靠世界坐标 UV 对齐</li>
        <li>混合层：边缘磨损与高度混合，仅近景启用</li>
      </ul>
      <blockquote>任何一层出问题，都能单独回滚，不需要重做整份材质。</blockquote>
      <pre># sampler defaults
SampleCount  16
TemporalAA   true</pre>
      <table>
        <thead>
          <tr><th>层</th><th>贴图</th><th>分辨率</th><th>说明</th></tr>
        </thead>
        <tbody>
          <tr><td>基础层</td><td>BaseColor / Roughness</td><td>2K</td><td>全场景共用</td></tr>
          <tr><td>细节层</td><td>Mask</td><td>1K</td><td>平铺，世界坐标对齐</td></tr>
          <tr><td>混合层</td><td>Height</td><td>2K</td><td>仅近景启用</td></tr>
        </tbody>
      </table>
    </div>
  );
}
