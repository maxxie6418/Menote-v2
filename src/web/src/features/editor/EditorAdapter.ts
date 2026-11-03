import type { TableCommandId, TableContext } from "./tableCommands";

/** 编辑器适配器接口（工程设计 3.2）：上层只面向 Markdown 字符串与光标偏移，不接触编辑器类型。 */
export interface EditorAdapter {
  /**
   * 载入文本。
   * @param options.keepBaseline 本地改动（插入附件、源码变换）传 true，表示沿用既有基线；
   *   外部写回（他端变更、属性区写回）不传，基线整体替换。
   */
  loadMarkdown(markdown: string, options?: { keepBaseline?: boolean }): void;
  getMarkdown(): string;
  /**
   * 应当持久化的文本（FR-EDT-8）。所见即所得适配器在此把未触碰的块回填成原文；
   * 源码适配器没有这层需要，返回的就是用户输入。缺省时上层退回 getMarkdown()。
   *
   * 这是**落盘出口**：按键不再整篇序列化，正文统一在这里按需取全量（FR-EDT-10）。
   */
  getPreservedMarkdown?(): string;
  /**
   * 给定文本是否与当前内容等价（编辑态正文空间）。用于判断外部回声是不是自己刚写的，
   * 避免把本地内容当成他端变更整篇重载。
   */
  isSameContent?(markdown: string): boolean;
  /**
   * 当前光标处的「/」菜单上下文（过滤词）。
   *
   * 所见即所得适配器走编辑器原生选区算，**不整篇序列化**（FR-EDT-10）；
   * 缺省时上层退回用 Markdown 文本算。
   */
  getSlashContext?(): { query: string } | null;
  /**
   * 取某个表格单元格元素对应的表格上下文（行列与对齐）。不在表格里返回 null。
   * 表格块操作菜单用它在悬停时显示当前状态（FR-EDT-9）。
   */
  getTableContextAt?(cell: HTMLElement): TableContext | null;
  /**
   * 对某个表格单元格元素所在的表格执行命令。成功返回 true。
   */
  runTableCommand?(command: TableCommandId, cell: HTMLElement): boolean;
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
  /**
   * `onInput` 是**脏信号**（FR-EDT-10）：只表示「正文变了」，不带正文——
   * 键入路径不再整篇序列化，正文统一由 `getPreservedMarkdown()` 在落盘出口取全量。
   */
  new (host: HTMLElement, options: { initialMarkdown: string; onInput: () => void }): EditorAdapter;
}
