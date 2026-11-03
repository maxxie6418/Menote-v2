import type { Item, TopicNode } from "@menote/shared";
import { parseEnvelope } from "./encryptionCommandService";
import { isNoteUnlocked, readPlain } from "./keyringService";
import { isHiddenPrivateItem } from "./privateSpaceService";

/** 本地检索命中（FR-IA-10）。摘要只来自可展示的明文，不缓存正文副本。 */
export interface SearchHit {
  item: Item;
  title: string;
  snippet: string;
  locked: boolean;
  titleMatch: boolean;
}

const RESULT_LIMIT = 50;

export function searchTokens(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function displayTitle(item: Item): string {
  const named = item.title?.trim();
  if (named) return named;
  if (item.content.scope === "plain") {
    const line = item.content.markdown.split("\n").map((row) => row.trim()).find(Boolean);
    if (line) return line.replace(/^#{1,6}\s*/, "").slice(0, 80);
  }
  return item.type === "memo" ? "无标题 Memo" : "无标题";
}

function topicLabel(item: Item, topics: TopicNode[]): string {
  if (!item.topicId) return "";
  const topic = topics.find((row) => row.id === item.topicId);
  if (!topic) return "";
  if (topic.isEncSpace) return "私人空间";
  const parent = topic.parentId ? topics.find((row) => row.id === topic.parentId) : undefined;
  return parent ? `${parent.name} ${topic.name}` : topic.name;
}

function plainText(markdown: string): string {
  return markdown.replace(/[#>*`_[\]!()]/g, " ").replace(/\s+/g, " ").trim();
}

function snippetAround(markdown: string, token: string): string {
  const source = markdown.toLocaleLowerCase();
  const at = source.indexOf(token);
  const start = at < 0 ? 0 : Math.max(0, at - 24);
  const slice = plainText(markdown.slice(start, start + 96));
  return `${start > 0 ? "…" : ""}${slice}`;
}

/** 清单内同步过滤：明文正文可匹配；锁定条目只看标题、标签，不读取密文。 */
export function filterItems(items: Item[], query: string): Item[] {
  const tokens = searchTokens(query);
  if (!tokens.length) return items;
  return items.filter((item) => {
    const titleBlob = `${displayTitle(item)}\n${item.tags.join(" ")}`.toLocaleLowerCase();
    const bodyBlob = item.content.scope === "plain" ? item.content.markdown.toLocaleLowerCase() : "";
    return tokens.every((token) => titleBlob.includes(token) || bodyBlob.includes(token));
  });
}

async function readableBody(item: Item): Promise<{ text: string; locked: boolean }> {
  if (item.content.scope === "plain") return { text: item.content.markdown, locked: false };
  if (!isNoteUnlocked(item.id)) return { text: "", locked: true };
  try {
    const plain = await readPlain(item.id, parseEnvelope(item.content.ciphertext));
    return plain === null ? { text: "", locked: true } : { text: plain, locked: false };
  } catch {
    return { text: "", locked: true };
  }
}

/** 全局检索。多词为“同时包含”。锁定加密条目只匹配标题、标签和主题名（FR-ENC-5）。 */
export async function searchLocalItems(items: Item[], topics: TopicNode[], query: string): Promise<SearchHit[]> {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const hits: SearchHit[] = [];
  for (const item of items) {
    if (item.deletedAt !== null || isHiddenPrivateItem(item, topics)) continue;
    const title = displayTitle(item);
    const titleBlob = `${title}\n${item.tags.join(" ")}\n${topicLabel(item, topics)}`.toLocaleLowerCase();
    const body = await readableBody(item);
    const bodyBlob = body.text.toLocaleLowerCase();
    if (!tokens.every((token) => titleBlob.includes(token) || bodyBlob.includes(token))) continue;
    const titleMatch = tokens.every((token) => titleBlob.includes(token));
    const bodyToken = tokens.find((token) => !titleBlob.includes(token) && bodyBlob.includes(token));
    hits.push({
      item,
      title,
      locked: body.locked,
      titleMatch,
      snippet: body.locked ? "已加密" : bodyToken ? snippetAround(body.text, bodyToken) : (plainText(body.text).slice(0, 80) || "无正文"),
    });
  }
  hits.sort((left, right) => Number(right.titleMatch) - Number(left.titleMatch) || right.item.updatedAt - left.item.updatedAt);
  return hits.slice(0, RESULT_LIMIT);
}
