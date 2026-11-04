import type { Item } from "@menote/shared";
import { localDb } from "./localDb";

/** 条目本地读写；读一律以本地库为源（分层规则：services → db → IndexedDB）。 */

export async function getItem(userId: string, id: string): Promise<Item | undefined> {
  const row = await localDb.items.get(id);
  return row && row.userId === userId ? row : undefined;
}

export async function listUserItems(userId: string): Promise<Item[]> {
  return localDb.items.where("userId").equals(userId).toArray();
}

export async function putItem(item: Item): Promise<void> {
  await localDb.items.put(item);
}

export async function bulkPutItems(items: Item[]): Promise<void> {
  await localDb.items.bulkPut(items);
}

/** 穿透聚合（FR-IA-3）：直属 + 子层级，扁平排列；回收站行不在此列出（G8 有独立入口）。 */
export async function listItemsInSubtree(userId: string, topicIds: string[]): Promise<Item[]> {
  const ids = new Set(topicIds);
  return localDb.items
    .where("userId").equals(userId)
    .filter((row) => row.deletedAt === null && (
      (row.topicId !== null && ids.has(row.topicId))
      || (row.groupId !== null && ids.has(row.groupId))
    ))
    .toArray();
}

/** 未归类（收件箱/草稿箱）：type ≠ memo 且 topicId 为空；source 区分两个固定入口。 */
export async function listUnfiled(userId: string, source: "manual" | "external"): Promise<Item[]> {
  return localDb.items
    .where("userId").equals(userId)
    .filter((row) => row.deletedAt === null && row.type !== "memo" && row.topicId === null
      && (source === "manual" ? row.source === "manual" : row.source !== "manual"))
    .toArray();
}

export async function listMemos(userId: string, limit = 200): Promise<Item[]> {
  const rows = await localDb.items
    .where("userId").equals(userId)
    .filter((row) => row.type === "memo" && row.deletedAt === null)
    .toArray();
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows.slice(0, limit);
}

export async function listTrashedItems(userId: string): Promise<Item[]> {
  return localDb.items.where("userId").equals(userId)
    .filter((row) => row.deletedAt !== null).toArray();
}

/** 最近编辑：全部非删除条目按 updatedAt 倒序（含未归类）。 */
export async function listRecentItems(userId: string, limit = 200): Promise<Item[]> {
  const rows = await localDb.items.where("userId").equals(userId)
    .filter((row) => row.deletedAt === null && row.type !== "memo").toArray();
  rows.sort((a, b) => b.updatedAt - a.updatedAt);
  return rows.slice(0, limit);
}
