import type { Item } from "@menote/shared";
import { FIELDS_KEY, readDefs, splitFrontmatter } from "../../lib/frontmatter";
import { findTables } from "../../lib/gfmTable";

/** 清单/卡片元信息行；时间用本地日期。 */
export function formatItemMeta(item: Item): string {
  const date = new Date(item.updatedAt);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  return `编辑于 ${time}`;
}

/** 清单行描述（design nr-d）：正文去标记后的纯文本摘要。
    frontmatter（属性表、表格字段定义）不进摘要，字段定义不往清单里泄；
    表格给结构摘要「x 行 x 列」（行按数据行计，不含表头）。 */
export function noteSnippet(item: Item): string {
  if (item.content.scope !== "plain") return "已加密";
  const markdown = item.content.markdown;
  if (item.type === "table") {
    const table = findTables(splitFrontmatter(markdown).body)[0];
    const columns = table?.header.length ?? Object.keys(readDefs(markdown, FIELDS_KEY)).length;
    return columns ? `${table?.rows.length ?? 0} 行 ${columns} 列` : "空表格";
  }
  return splitFrontmatter(markdown).body.replace(/[#>*`\-\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}
