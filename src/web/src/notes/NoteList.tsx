/* 清单空态（DESIGN §8.3：一句说明 + 快捷键提示，不放插画）。
   笔记列表在 M2 接入本地库与同步后填充。 */
export function NoteList() {
  return (
    <div className="mn-empty" role="status">
      <div>
        <p className="mn-empty-title">还没有笔记</p>
        <p className="mn-empty-detail">笔记功能将在后续版本开放，届时新建的内容会出现在这里。</p>
        <p className="mn-empty-key">⌘ N</p>
      </div>
    </div>
  );
}
