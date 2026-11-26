import type { SettingsSection } from "../features/settings";
import type { BrowseSection } from "../services/contentHooks";

export type RouteSection =
  | { kind: "recent" | "inbox" | "drafts" | "starred" | "trash" }
  | { kind: "topic"; id: string }
  | { kind: "tag"; tag: string };

export type AppRoute =
  | { kind: "home" }
  | { kind: "me" }
  | { kind: "status" }
  | { kind: "notes"; section: RouteSection; itemId?: string }
  | { kind: "memos"; itemId?: string; tag?: string }
  | { kind: "settings"; section: SettingsSection };

/** 全局标签入口再次点击当前标签时清除筛选。 */
export function toggleGlobalTagSection(current: BrowseSection, tag: string, memoTags: ReadonlySet<string>): BrowseSection {
  const currentTag = current.kind === "tag" || current.kind === "memos" ? current.tag : null;
  if (currentTag === tag) return current.kind === "memos" ? { kind: "memos" } : { kind: "recent" };
  return memoTags.has(tag) ? { kind: "memos", tag } : { kind: "tag", tag };
}

const SETTINGS_SECTIONS: SettingsSection[] = ["appearance", "sync", "style", "ai", "plugins", "backup", "attachments", "syncLogs", "recovery", "mcp", "clipTemplates", "propertyTemplates"];

function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try { return decodeURIComponent(segment); } catch { return null; }
}

// UUID item IDs are encoded as 16 bytes in base64url (22 chars) for readable,
// shareable application URLs. Non-UUID IDs and legacy UUID URLs stay valid.
function encodeItemId(id: string): string {
  const hex = id.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) return encodeURIComponent(id);
  let binary = "";
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeItemId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return value;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "==");
    if (binary.length !== 16) return value;
    const hex = Array.from(binary, (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch { return value; }
}

export function appRoutePath(route: AppRoute): string {
  if (route.kind === "home") return "/home";
  if (route.kind === "me") return "/me";
  if (route.kind === "status") return "/status";
  if (route.kind === "settings") return `/settings/${encodeURIComponent(route.section)}`;
  if (route.kind === "memos") {
    if (route.tag) return `/memos/tag/${encodeURIComponent(route.tag)}`;
    return route.itemId ? `/memos/${encodeItemId(route.itemId)}` : "/memos";
  }
  if (route.itemId) return `/n/${encodeItemId(route.itemId)}`;

  if (route.section.kind === "recent") return "/notes";
  if (route.section.kind === "topic") return `/topics/${encodeURIComponent(route.section.id)}/notes`;
  if (route.section.kind === "tag") return `/tags/${encodeURIComponent(route.section.tag)}/notes`;
  return `/${route.section.kind}`;
}

export function parseAppRoute(pathname: string): AppRoute {
  const parts = pathname.split("/").filter(Boolean).map(decodeSegment);
  if (parts.some((part) => part === null)) return { kind: "home" };
  const [root, second, third, fourth] = parts as string[];
  if (!root || root === "home") return { kind: "home" };
  if (root === "me") return { kind: "me" };
  if (root === "status") return { kind: "status" };
  if (root === "settings") {
    const section = SETTINGS_SECTIONS.includes(second as SettingsSection) ? second as SettingsSection : "backup";
    return { kind: "settings", section };
  }
  if (root === "n") return { kind: "notes", section: { kind: "recent" }, ...(second ? { itemId: decodeItemId(second) } : {}) };
  if (root === "memos") {
    if (second === "tag" && third) return { kind: "memos", tag: third };
    return { kind: "memos", ...(second ? { itemId: decodeItemId(second) } : {}) };
  }
  if (root === "notes" || root === "inbox" || root === "drafts" || root === "starred" || root === "trash") {
    const section: RouteSection = root === "notes" ? { kind: "recent" }
      : root === "inbox" ? { kind: "inbox" }
        : root === "drafts" ? { kind: "drafts" }
          : root === "starred" ? { kind: "starred" }
            : { kind: "trash" };
    return { kind: "notes", section, ...(second ? { itemId: decodeItemId(second) } : {}) };
  }
  if (root === "topics" && second) {
    const itemId = third === "notes" ? decodeItemId(fourth) : undefined;
    return { kind: "notes", section: { kind: "topic", id: second }, ...(itemId ? { itemId } : {}) };
  }
  if (root === "tags" && second) {
    const itemId = third === "notes" ? decodeItemId(fourth) : undefined;
    return { kind: "notes", section: { kind: "tag", tag: second }, ...(itemId ? { itemId } : {}) };
  }
  return { kind: "home" };
}

/** Canonical short URL path for a Note or Table, accepted by the browser extension. */
export function itemRoutePath(itemId: string): string {
  return `/n/${encodeItemId(itemId)}`;
}
