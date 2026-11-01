/** 编辑器适配器接口（工程设计 3.2）：上层只面向 Markdown 字符串与光标偏移，不接触编辑器类型。 */
export interface EditorAdapter {
  loadMarkdown(markdown: string): void;
  getMarkdown(): string;
  /** 当前选区，UTF-16 偏移，与 textarea 一致。折叠时 start 等于 end。 */
  getSelection(): { start: number; end: number };
  /** 载入后把光标放到指定偏移。 */
  setSelection(start: number, end: number): void;
  /** 光标的屏幕坐标，供「/」菜单跟随。编辑器没有光标时返回 null。 */
  caretRect(): { top: number; left: number; bottom: number } | null;
  focus(): void;
  /** 上层只面向接口；onInput 由宿主在挂载时传入（构造期），用于自动保存联动。 */
  destroy(): void;
}

export interface EditorAdapterCtor {
  new (host: HTMLElement, options: { initialMarkdown: string; onInput: (markdown: string) => void }): EditorAdapter;
}
