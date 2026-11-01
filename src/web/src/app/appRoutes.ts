import type { SettingsSection } from "../features/settings";

export type RouteSection =
  | { kind: "recent" | "inbox" | "drafts" | "starred" | "trash" }
  | { kind: "topic"; id: string }
  | { kind: "tag"; tag: string };

export type AppRoute =
  | { kind: "home" | "me" | "status" }
  | { kind: "notes"; section: RouteSection; itemId?: string }
  | { kind: "memos"; itemId?: string }
  | { kind: "settings"; section: SettingsSection };

const SETTINGS_SECTIONS: SettingsSection[] = ["appearance", "backup", "attachments", "recovery", "mcp", "clipTemplates"];

function decodeSegment(segment: string | undefined): string | null {
  if (!segment) return null;
  try { return decodeURIComponent(segment); } catch { return null; }
}

export function appRoutePath(route: AppRoute): string {
  if (route.kind === "home") return "/home";
  if (route.kind === "me") return "/me";
  if (route.kind === "status") return "/status";
  if (route.kind === "settings") return `/settings/${encodeURIComponent(route.section)}`;
  if (route.kind === "memos") return route.itemId ? `/memos/${encodeURIComponent(route.itemId)}` : "/memos";

  const suffix = route.itemId ? `/${encodeURIComponent(route.itemId)}` : "";
  if (route.section.kind === "recent") return `/notes${suffix}`;
  if (route.section.kind === "topic") return `/topics/${encodeURIComponent(route.section.id)}/notes${suffix}`;
  if (route.section.kind === "tag") return `/tags/${encodeURIComponent(route.section.tag)}/notes${suffix}`;
  return `/${route.section.kind}${suffix}`;
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
  if (root === "memos") return { kind: "memos", ...(second ? { itemId: second } : {}) };
  if (root === "notes" || root === "inbox" || root === "drafts" || root === "starred" || root === "trash") {
    const section = root === "notes" ? { kind: "recent" as const } : { kind: root };
    return { kind: "notes", section, ...(second ? { itemId: second } : {}) };
  }
  if (root === "topics" && second) {
    const itemId = third === "notes" ? fourth : undefined;
    return { kind: "notes", section: { kind: "topic", id: second }, ...(itemId ? { itemId } : {}) };
  }
  if (root === "tags" && second) {
    const itemId = third === "notes" ? fourth : undefined;
    return { kind: "notes", section: { kind: "tag", tag: second }, ...(itemId ? { itemId } : {}) };
  }
  return { kind: "home" };
}

/** Canonical shareable URL path for a Note or Table, accepted by the browser extension. */
export function itemRoutePath(itemId: string): string {
  return appRoutePath({ kind: "notes", section: { kind: "recent" }, itemId });
}
