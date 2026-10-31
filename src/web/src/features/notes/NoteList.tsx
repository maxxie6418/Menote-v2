import { NoteEmptyState } from "./NoteEmptyState";

/* 清单视图：当前为空态骨架，列表行在 M2 接入本地库与同步后填充。 */
export function NoteList() {
  return (
    <NoteEmptyState
      title="还没有笔记"
      detail="笔记功能将在后续版本开放，届时新建的内容会出现在这里。"
      shortcut="⌘ N"
    />
  );
}
