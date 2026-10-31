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
