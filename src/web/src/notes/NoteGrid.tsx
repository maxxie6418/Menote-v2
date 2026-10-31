/* 网格空态，与列表空态同文案（DESIGN §8.3）。 */
export function NoteGrid() {
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
