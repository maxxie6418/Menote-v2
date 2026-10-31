/** 编辑器适配器接口（工程设计 3.2）：M2 源码形态，M3 WYSIWYG 经同一接口接管，上层零改造。 */
export interface EditorAdapter {
  loadMarkdown(markdown: string): void;
  getMarkdown(): string;
  focus(): void;
  /** 上层只面向接口；onInput 由宿主在挂载时传入（构造期），用于自动保存联动。 */
  destroy(): void;
}

export interface EditorAdapterCtor {
  new (host: HTMLElement, options: { initialMarkdown: string; onInput: (markdown: string) => void }): EditorAdapter;
}
