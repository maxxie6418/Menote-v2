/** 当前标签页的编辑保存出口；只持有回调与变更序号，不缓存正文或密钥。 */
type EditorSave = () => Promise<boolean>;

const editors = new Map<string, Set<EditorSave>>();
const listeners = new Set<() => void>();
let revision = 0;

export function registerEditorSave(userId: string, editor: EditorSave): () => void {
  const entries = editors.get(userId) ?? new Set<EditorSave>();
  editors.set(userId, entries);
  entries.add(editor);
  return () => { entries.delete(editor); if (!entries.size) editors.delete(userId); };
}

export function notifyEditorChange(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

export function getEditorRevision(): number { return revision; }

export function subscribeEditorChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export async function saveEditors(userId: string): Promise<boolean> {
  // 依次保存，正文和标题共享内容命令队列，任一失败就停止上传。
  for (const editor of [...(editors.get(userId) ?? [])]) {
    if (!await editor()) return false;
  }
  return true;
}
