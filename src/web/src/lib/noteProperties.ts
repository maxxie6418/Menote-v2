import type { Item } from "@menote/shared";
import { parseFrontmatterData, tryParseFrontmatterData, writeValue } from "./frontmatter";

export function noteTagKey(value: string): string {
  return value.trim().replace(/^#/, "").normalize("NFC").toLowerCase();
}

export function normalizeNoteTags(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const tag = value.trim().replace(/^#/, "");
    const key = noteTagKey(tag);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });
}

function textList(value: unknown): string[] | undefined {
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

export function readNoteYamlTags(markdown: string): string[] | undefined {
  return yamlTags(parseFrontmatterData(markdown));
}

function yamlTags(values: Record<string, unknown>): string[] | undefined {
  const raw = Object.hasOwn(values, "tags") ? values.tags : values.tag;
  const tags = textList(raw);
  return tags ? normalizeNoteTags(tags) : undefined;
}

export function readNoteAliases(markdown: string): string[] {
  const values = parseFrontmatterData(markdown);
  const aliases = textList(Object.hasOwn(values, "aliases") ? values.aliases : values.alias) ?? [];
  return [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
}

export function sameNoteTags(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  return left === right || Boolean(left && right && left.length === right.length && left.every((value, index) => value === right[index]));
}

/** Legacy note labels remain visible until their next explicit label edit. */
export function effectiveNoteTags(item: Item): string[] {
  if (item.type !== "note" || item.content.scope !== "plain") return item.tags;
  const yaml = readNoteYamlTags(item.content.markdown);
  return normalizeNoteTags([...(yaml ?? []), ...item.tags]);
}

export function withEffectiveNoteTags(item: Item): Item {
  const tags = effectiveNoteTags(item);
  return sameNoteTags(tags, item.tags) ? item : { ...item, tags };
}

export function noteTagsAfterContentEdit(item: Item, markdown: string): string[] {
  if (item.type !== "note" || item.content.scope !== "plain") return item.tags;
  const oldYaml = readNoteYamlTags(item.content.markdown);
  const data = tryParseFrontmatterData(markdown);
  if (!data) return effectiveNoteTags(item);
  const newYaml = yamlTags(data);
  if (newYaml && !sameNoteTags(oldYaml, newYaml)) return newYaml;
  if (oldYaml && newYaml === undefined && !Object.hasOwn(data, "tags") && !Object.hasOwn(data, "tag")) return [];
  return effectiveNoteTags(item);
}

export function writeNoteYamlTags(markdown: string, values: readonly string[]): string {
  const tags = normalizeNoteTags(values);
  const metadata = parseFrontmatterData(markdown);
  if (Array.isArray(metadata.tags) && sameNoteTags(textList(metadata.tags), tags)) return markdown;
  if (!tags.length && !Object.hasOwn(metadata, "tags") && !Object.hasOwn(metadata, "tag")) return markdown;
  return writeValue(markdown, "tags", tags);
}

export function obsidianExportMarkdown(item: Item): string {
  if (item.content.scope !== "plain") return "";
  const markdown = item.content.markdown;
  if (item.type !== "note") return markdown;
  if (!item.tags.length && readNoteYamlTags(markdown) === undefined) return markdown;
  try {
    return writeNoteYamlTags(markdown, effectiveNoteTags(item));
  } catch {
    return markdown;
  }
}
