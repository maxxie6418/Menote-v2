import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Item, TopicNode } from "@menote/shared";
import { listItemsInSubtree, listMemos, listRecentItems, listTrashedItems, listUnfiled, getItem } from "../db/itemsRepo";
import { listSubtreeIds, listTopics } from "../db/topicsRepo";
import { subscribeLocalChanges } from "../lib/broadcast";

/** 服务层数据钩子：UI 只经此读取本地库（结构检查：UI 禁直连 IndexedDB）。
 *  同标签页由 liveQuery 自动更新；跨标签页经无内容广播触发重读（refresh 版本号参与查询键）。 */

export function useLocalRefresh(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => subscribeLocalChanges(() => setVersion((value) => value + 1)), []);
  return version;
}

function useData<T>(querier: () => Promise<T> | undefined, deps: unknown[], enabled: boolean): T | undefined {
  const refresh = useLocalRefresh();
  return useLiveQuery(querier, [...deps, enabled, refresh], undefined);
}

export function useTopics(userId: string): TopicNode[] {
  return useData(() => (userId ? listTopics(userId) : undefined), [userId], Boolean(userId)) ?? [];
}

export function useNotesInTopic(userId: string, topicId: string): Item[] {
  return useData(async () => {
    if (!userId || !topicId) return [];
    const rows = await listItemsInSubtree(userId, await listSubtreeIds(userId, topicId));
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows;
  }, [userId, topicId], Boolean(userId && topicId)) ?? [];
}

export function useInbox(userId: string): Item[] {
  return useData(() => (userId ? listUnfiled(userId, "external") : undefined), [userId], Boolean(userId)) ?? [];
}

export function useDrafts(userId: string): Item[] {
  return useData(() => (userId ? listUnfiled(userId, "manual") : undefined), [userId], Boolean(userId)) ?? [];
}

/** 最近编辑：全部非删除条目按 updatedAt 倒序（含未归类）。 */
export function useRecentItems(userId: string): Item[] {
  return useData(() => (userId ? listRecentItems(userId) : undefined), [userId], Boolean(userId)) ?? [];
}

export function useMemos(userId: string): Item[] {
  return useData(() => (userId ? listMemos(userId) : undefined), [userId], Boolean(userId)) ?? [];
}

export function useItem(userId: string, id: string | null): Item | undefined {
  return useData(() => (userId && id ? getItem(userId, id) : undefined), [userId, id], Boolean(userId && id));
}

export function useTrashedItems(userId: string): Item[] {
  return useData(() => (userId ? listTrashedItems(userId) : undefined), [userId], Boolean(userId)) ?? [];
}

/** 侧栏导航分区（UI 会话级状态，不含内容）。 */
export type BrowseSection =
  | { kind: "recent" | "inbox" | "drafts" | "memos" | "starred" | "trash" }
  | { kind: "topic"; id: string }
  | { kind: "tag"; tag: string };

/** 全部标签（去重，FR-IA-8 标签入口）。 */
export function useAllTags(userId: string): string[] {
  return useData(async () => {
    if (!userId) return [];
    const { localDb } = await import("../db/localDb");
    const rows = await localDb.items.where("userId").equals(userId)
      .filter((row) => row.deletedAt === null).toArray();
    return [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) => a.localeCompare(b));
  }, [userId], Boolean(userId)) ?? [];
}

export function useTagItems(userId: string, tag: string): Item[] {
  return useData(async () => {
    if (!userId || !tag) return [];
    const { localDb } = await import("../db/localDb");
    const rows = await localDb.items.where("userId").equals(userId)
      .filter((row) => row.deletedAt === null && row.type !== "memo" && row.tags.includes(tag)).toArray();
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows;
  }, [userId, tag], Boolean(userId && tag)) ?? [];
}

export function useStarredItems(userId: string): Item[] {
  return useData(async () => {
    if (!userId) return [];
    const { localDb } = await import("../db/localDb");
    const rows = await localDb.items.where("userId").equals(userId)
      .filter((row) => row.deletedAt === null && row.type !== "memo" && row.starred).toArray();
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows;
  }, [userId], Boolean(userId)) ?? [];
}

/** 当前分区的清单数据（Note 类分区）；全部钩子无条件调用（React hooks 规则），按分区取值。 */
export function useSectionItems(userId: string, section: BrowseSection): Item[] | undefined {
  const topic = useNotesInTopic(userId, section.kind === "topic" ? section.id : "");
  const inbox = useInbox(userId);
  const drafts = useDrafts(userId);
  const recent = useRecentItems(userId);
  const tag = useTagItems(userId, section.kind === "tag" ? section.tag : "");
  const starred = useStarredItems(userId);
  const trash = useTrashedItems(userId);
  if (section.kind === "topic") return topic;
  if (section.kind === "inbox") return inbox;
  if (section.kind === "drafts") return drafts;
  if (section.kind === "tag") return tag;
  if (section.kind === "starred") return starred;
  if (section.kind === "trash") return trash;
  return recent;
}

import { subscribeLockState, getLockVersion } from "./keyring";

/** 锁定状态版本号（G7）：解锁/锁定时触发重渲染。 */
export function useLockVersion(): number {
  const [version, setVersion] = useState(getLockVersion);
  useEffect(() => subscribeLockState(() => setVersion(getLockVersion())), []);
  return version;
}
