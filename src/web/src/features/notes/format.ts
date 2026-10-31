import type { Item } from "@menote/shared";

/** 清单/卡片元信息行；时间用本地日期。 */
export function formatItemMeta(item: Item): string {
  const date = new Date(item.updatedAt);
  const sameDay = new Date().toDateString() === date.toDateString();
  const time = sameDay
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
  return `编辑于 ${time}`;
}

/** 清单行描述（design nr-d）：正文去标记后的纯文本摘要。 */
export function noteSnippet(item: Item): string {
  if (item.content.scope !== "plain") return "已加密";
  return item.content.markdown.replace(/[#>*`\-\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
}
