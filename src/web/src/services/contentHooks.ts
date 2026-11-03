import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Item, MemoComment, TopicNode } from "@menote/shared";
import { listItemsInSubtree, listMemos, listRecentItems, listTrashedItems, listUnfiled, getItem } from "../db/itemsRepo";
import { listMemoComments } from "../db/memoCommentsRepo";
import { listSubtreeIds, listTopics } from "../db/topicsRepo";
import { subscribeLocalChanges } from "../lib/broadcast";
import { countPendingOutbox } from "../db/outboxRepo";
import { hiddenPrivateTopicIds } from "./privateSpaceService";

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

/** 首页快照：只在服务层读取当前用户的完整本地条目集合，供状态统计与主题计数使用。 */
export function useHomeSnapshot(userId: string): { items: Item[]; topics: TopicNode[] } {
  return useData(async () => {
    if (!userId) return { items: [], topics: [] };
    const { localDb } = await import("../db/localDb");
    const [items, topics] = await Promise.all([
      localDb.items.where("userId").equals(userId).filter((row) => row.deletedAt === null).toArray(),
      listTopics(userId),
    ]);
    return { items, topics: topics.filter((topic) => topic.deletedAt === null) };
  }, [userId], Boolean(userId)) ?? { items: [], topics: [] };
}

/** 当前本地待同步队列条数，供「我的」同步概览展示。 */
export function usePendingOutboxCount(): number {
  return useData(() => countPendingOutbox(), [], true) ?? 0;
}

export function useMemos(userId: string): Item[] {
  return useData(() => (userId ? listMemos(userId) : undefined), [userId], Boolean(userId)) ?? [];
}

export function useMemoComments(userId: string, memoId: string): MemoComment[] {
  return useData(() => (userId && memoId ? listMemoComments(userId, memoId) : undefined), [userId, memoId], Boolean(userId && memoId)) ?? [];
}

export function useItem(userId: string, id: string | null): Item | undefined {
  return useData(() => (userId && id ? getItem(userId, id) : undefined), [userId, id], Boolean(userId && id));
}

export function useTrashedItems(userId: string): Item[] {
  return useData(() => (userId ? listTrashedItems(userId) : undefined), [userId], Boolean(userId)) ?? [];
}

/** 侧栏导航分区（UI 会话级状态，不含内容）。 */
export type BrowseSection =
  | { kind: "home" | "recent" | "inbox" | "drafts" | "memos" | "starred" | "trash" }
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
      .filter((row) => row.deletedAt === null && row.starred).toArray();
    rows.sort((a, b) => b.updatedAt - a.updatedAt);
    return rows;
  }, [userId], Boolean(userId)) ?? [];
}

/** 当前分区的清单数据（Note 类分区）；全部钩子无条件调用（React hooks 规则），按分区取值。 */
export function useSectionItems(userId: string, section: BrowseSection): Item[] | undefined {
  const topics = useTopics(userId);
  useLockVersion();
  const topic = useNotesInTopic(userId, section.kind === "topic" ? section.id : "");
  const inbox = useInbox(userId);
  const drafts = useDrafts(userId);
  const recent = useRecentItems(userId);
  const tag = useTagItems(userId, section.kind === "tag" ? section.tag : "");
  const starred = useStarredItems(userId);
  const trash = useTrashedItems(userId);
  const hidden = hiddenPrivateTopicIds(topics);
  const mask = (rows: Item[] | undefined) => rows?.filter((item) => item.topicId === null || !hidden.has(item.topicId));
  if (section.kind === "topic") return hidden.has(section.id) ? [] : topic;
  if (section.kind === "inbox") return mask(inbox);
  if (section.kind === "drafts") return mask(drafts);
  if (section.kind === "tag") return mask(tag);
  if (section.kind === "starred") return mask(starred);
  if (section.kind === "trash") return mask(trash);
  return mask(recent);
}

import { subscribeLockState, getLockVersion } from "./keyringService";
import { searchLocalItems, searchTokens, type SearchHit } from "./searchService";

/** 锁定状态版本号（G7）：解锁/锁定时触发重渲染。 */
export function useLockVersion(): number {
  const [version, setVersion] = useState(getLockVersion);
  useEffect(() => subscribeLockState(() => setVersion(getLockVersion())), []);
  return version;
}

/** 已启用加密的条目数（设置·恢复码区展示用）。 */
export function useEncryptedCount(userId: string): number {
  return useData(async () => {
    if (!userId) return 0;
    const { localDb } = await import("../db/localDb");
    return localDb.items.where("userId").equals(userId)
      .filter((item) => item.content.scope !== "plain").count();
  }, [userId], Boolean(userId)) ?? 0;
}


function useDebounced(value: string, delay = 150): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** 首页与移动首页的全局本地检索。空查询不查库。 */
export function useLocalSearch(userId: string, query: string): SearchHit[] | undefined {
  const lockVersion = useLockVersion();
  const debounced = useDebounced(query, 150);
  const active = query.trim() ? debounced : "";
  const pending = query.trim() !== debounced.trim();
  const hits = useData(async () => {
    if (!userId || !searchTokens(active).length) return [];
    const { localDb } = await import("../db/localDb");
    const { listTopics } = await import("../db/topicsRepo");
    const [items, topics] = await Promise.all([
      localDb.items.where("userId").equals(userId).filter((row) => row.deletedAt === null).toArray(),
      listTopics(userId),
    ]);
    return searchLocalItems(items, topics, active);
  }, [userId, active, lockVersion], Boolean(userId));
  if (!query.trim()) return [];
  return pending ? undefined : hits;
}
