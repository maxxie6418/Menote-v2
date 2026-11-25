import { useLiveQuery } from "dexie-react-hooks";
import type { Item, TopicNode } from "@menote/shared";
import { getItem, listActiveItems } from "../db/itemsRepo";
import { listTopics } from "../db/topicsRepo";
import { normalizeObsidianName } from "../lib/obsidianMarkdown";
import { readNoteAliases } from "../lib/noteProperties";
import { alwaysHiddenPrivateTopicIds } from "./privateSpaceService";
import { useLocalRefresh } from "./contentHooks";

interface ObsidianLinkChoice { id: string; label: string; path: string }
const EMPTY_REFERENCES = { targets: new Map<string, string | null>(), choices: [] as ObsidianLinkChoice[] };

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
  return useObsidianReferences(userId, enabled).targets;
}

export function useObsidianReferences(userId: string | undefined, enabled: boolean) {
  const refresh = useLocalRefresh(!!userId && enabled);
  const result = useLiveQuery(async () => {
    if (!userId || !enabled) return undefined;
    const [items, topics] = await Promise.all([listActiveItems(userId), listTopics(userId)]);
    return { userId, ...buildObsidianReferences(items, topics) };
  }, [userId, enabled, refresh]);
  return enabled && result?.userId === userId ? result ?? EMPTY_REFERENCES : EMPTY_REFERENCES;
}

export function buildObsidianReferences(items: Item[], topics: TopicNode[]) {
  const hidden = alwaysHiddenPrivateTopicIds(topics);
  const topicsById = new Map(topics.map((topic) => [topic.id, topic]));
  const targets = new Map<string, string | null>();
  const aliases = new Map<string, string | null>();
  const notes: { id: string; title: string; path: string; aliases: string[] }[] = [];
  const add = (map: Map<string, string | null>, key: string, id: string) => {
    const normalized = normalizeObsidianName(key);
    map.set(normalized, map.has(normalized) && map.get(normalized) !== id ? null : id);
  };
  for (const item of items) {
    if (item.type !== "note" || !item.title || item.deletedAt !== null || item.content.scope !== "plain"
      || (item.topicId && hidden.has(item.topicId)) || (item.groupId && hidden.has(item.groupId))) continue;
    const folder = topicPath(item.groupId ?? item.topicId, topicsById);
    const path = folder ? `${folder}/${item.title}` : item.title;
    add(targets, item.title, item.id);
    add(targets, path, item.id);
    const names = readNoteAliases(item.content.markdown);
    names.forEach((name) => add(aliases, name, item.id));
    notes.push({ id: item.id, title: item.title, path, aliases: names });
  }
  const choices = notes.flatMap((note) => {
    const path = targets.get(normalizeObsidianName(note.title)) === note.id ? note.title : note.path;
    if (targets.get(normalizeObsidianName(path)) !== note.id || /[|\[\]#\r\n]/.test(path)) return [];
    return [note.title, ...note.aliases.filter((alias) => alias !== note.title && !/[|\[\]\r\n]/.test(alias))]
      .map((label) => ({ id: `${note.id}:${label}`, label, path }));
  });
  for (const [alias, id] of aliases) if (!targets.has(alias)) targets.set(alias, id);
  return { targets, choices };
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
