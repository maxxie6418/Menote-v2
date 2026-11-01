import type { BlockAction, InlineAction } from "./markdownEdit";

export interface FormatAction {
  id: InlineAction | BlockAction;
  label: string;
  /** 分组：行内在前，块级在后，中间加分隔。 */
  group: "inline" | "block";
}

/** 格式栏与「/」菜单的同一份清单（FR-EDT-4/6）。两处都出全套，后续再决定精简。 */
export const FORMAT_ACTIONS: readonly FormatAction[] = [
  { id: "bold", label: "加粗", group: "inline" },
  { id: "italic", label: "斜体", group: "inline" },
  { id: "strike", label: "删除线", group: "inline" },
  { id: "code", label: "行内代码", group: "inline" },
  { id: "link", label: "链接", group: "inline" },
  { id: "heading1", label: "一级标题", group: "block" },
  { id: "heading2", label: "二级标题", group: "block" },
  { id: "heading3", label: "三级标题", group: "block" },
  { id: "bullet", label: "无序列表", group: "block" },
  { id: "ordered", label: "有序列表", group: "block" },
  { id: "task", label: "任务列表", group: "block" },
  { id: "quote", label: "引用", group: "block" },
  { id: "codeblock", label: "代码块", group: "block" },
  { id: "hr", label: "分隔线", group: "block" },
  { id: "table", label: "表格", group: "block" },
  { id: "image", label: "图片", group: "block" },
];

export function filterActions(query: string): FormatAction[] {
  const keyword = query.trim().replace(/^\//, "");
  if (!keyword) return [...FORMAT_ACTIONS];
  return FORMAT_ACTIONS.filter((action) => action.label.includes(keyword) || action.id.includes(keyword.toLowerCase()));
}
