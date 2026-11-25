import { useLiveQuery } from "dexie-react-hooks";
import type { TopicNode } from "@menote/shared";
import { getItem, listActiveItems } from "../db/itemsRepo";
import { listTopics } from "../db/topicsRepo";
import { normalizeObsidianName } from "../lib/obsidianMarkdown";
import { alwaysHiddenPrivateTopicIds } from "./privateSpaceService";
import { useLocalRefresh } from "./contentHooks";

const EMPTY_TARGETS: ReadonlyMap<string, string | null> = new Map();

function topicPath(id: string | null, topics: Map<string, TopicNode>): string {
  const seen = new Set<string>();
  const names: string[] = [];
  while (id && !seen.has(id)) {
    const topic = topics.get(id);
    if (!topic) break;
    seen.add(id);
    names.unshift(topic.name);
    id = topic.parentId;
  }
  return names.join("/");
}

export function obsidianNoteTarget(targets: ReadonlyMap<string, string | null>, path: string): string | null {
  const normalized = normalizeObsidianName(path.replace(/^\.\//, "").replace(/\.md$/i, ""));
  if (targets.has(normalized)) return targets.get(normalized) ?? null;
  return targets.get(normalized.split("/").at(-1) ?? "") ?? null;
}

export function useObsidianTargets(userId: string | undefined, enabled: boolean): ReadonlyMap<string, string | null> {
  const refresh = useLocalRefresh(!!userId && enabled);
  return useLiveQuery(async () => {
    if (!userId || !enabled) return EMPTY_TARGETS;
    const [items, topics] = await Promise.all([listActiveItems(userId), listTopics(userId)]);
    const hidden = alwaysHiddenPrivateTopicIds(topics);
    const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
    const targets = new Map<string, string | null>();
    const add = (key: string, id: string) => {
      const normalized = normalizeObsidianName(key);
      if (targets.has(normalized) && targets.get(normalized) !== id) targets.set(normalized, null);
      else targets.set(normalized, id);
    };
    for (const item of items) {
      if (item.type !== "note" || !item.title || item.content.scope !== "plain"
        || (item.topicId && hidden.has(item.topicId)) || (item.groupId && hidden.has(item.groupId))) continue;
      add(item.title, item.id);
      const path = topicPath(item.groupId ?? item.topicId, topicsById);
      if (path) add(`${path}/${item.title}`, item.id);
    }
    return targets;
  }, [userId, enabled, refresh], EMPTY_TARGETS);
}

export function useObsidianEmbed(userId: string, itemId: string | null): string | undefined {
  const refresh = useLocalRefresh(!!itemId);
  const result = useLiveQuery(async () => {
    if (!itemId) return undefined;
    const [item, topics] = await Promise.all([getItem(userId, itemId), listTopics(userId)]);
    const hidden = alwaysHiddenPrivateTopicIds(topics);
    if (!item || item.type !== "note" || item.deletedAt != null || item.content.scope !== "plain"
      || (item.topicId && hidden.has(item.topicId)) || (item.groupId && hidden.has(item.groupId))) return undefined;
    return { userId, itemId, markdown: item.content.markdown };
  }, [userId, itemId, refresh]);
  return result?.userId === userId && result.itemId === itemId ? result.markdown : undefined;
}
