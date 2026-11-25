import { useMemo, type ReactNode } from "react";
import { itemRoutePath } from "../../app/appRoutes";
import { attachmentUrl } from "../../services/attachmentService";
import { obsidianNoteTarget, useObsidianEmbed } from "../../services/obsidianReferenceService";
import { obsidianAnchor, obsidianExcerpt } from "../../lib/obsidianMarkdown";
import type { AttachmentRef } from "../../lib/attachmentRefs";
import { splitFrontmatter } from "../../lib/frontmatter";
import { UnlockedAttachment } from "../attachments";

export interface ObsidianView {
  userId: string;
  itemId: string;
  trail?: readonly string[];
  targets?: ReadonlyMap<string, string | null>;
}

interface ReferenceProps {
  data: Record<string, unknown>;
  label: ReactNode;
  view: ObsidianView;
  source: string;
  attachments: ReadonlyMap<string, AttachmentRef | null>;
  encryptedAttachmentItemId?: string;
  targets: ReadonlyMap<string, string | null>;
  block: boolean;
  renderEmbedded: (markdown: string, view: ObsidianView) => ReactNode;
}

function positiveSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function ObsidianReference({ data, label, source, view, attachments, encryptedAttachmentItemId,
  targets, block, renderEmbedded }: ReferenceProps) {
  const embed = data["data-obsidian-reference"] === "embed";
  const path = String(data["data-obsidian-path"] ?? "");
  const heading = typeof data["data-obsidian-heading"] === "string" ? data["data-obsidian-heading"] : undefined;
  const blockId = typeof data["data-obsidian-block"] === "string" ? data["data-obsidian-block"] : undefined;
  const file = embed ? attachments.get(path.split("/").at(-1)?.normalize("NFC").toLowerCase() ?? "") : null;
  const id = file ? null : path ? obsidianNoteTarget(targets, path) : view.itemId;
  const anchor = obsidianAnchor({ heading, blockId });
  const fragment = anchor ? `#${encodeURIComponent(anchor)}` : "";
  const href = id ? `${id === view.itemId && fragment ? "" : itemRoutePath(id)}${fragment}` : null;
  const key = id ? `${id}${fragment}` : null;
  const cyclic = !key || view.trail?.includes(key) || (id === view.itemId && !fragment);
  const remote = useObsidianEmbed(view.userId, embed && !cyclic && id !== view.itemId ? id : null);
  const embedded = useMemo(() => {
    if (!embed || !id || cyclic) return null;
    const body = id === view.itemId ? source : remote !== undefined ? splitFrontmatter(remote).body : null;
    return body === null ? null : obsidianExcerpt(body, { heading, blockId });
  }, [embed, id, cyclic, view.itemId, remote, source, heading, blockId]);

  if (file) {
    const image = /\.(?:avif|bmp|gif|jpe?g|png|webp)$/i.test(file.name);
    if (encryptedAttachmentItemId) {
      return <UnlockedAttachment itemId={encryptedAttachmentItemId} sha256={file.sha256} name={file.name} image={image}>{label}</UnlockedAttachment>;
    }
    const url = attachmentUrl(file.sha256);
    if (image) return <img src={url} alt={file.name} loading="lazy"
      width={positiveSize(data["data-obsidian-width"])} height={positiveSize(data["data-obsidian-height"])} />;
    if (block && /\.(?:mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return <audio controls src={url} preload="none" />;
    if (block && /\.(?:mp4|webm|mov|ogv)$/i.test(file.name)) return <video controls src={url} preload="none" />;
    const page = Number(data["data-obsidian-page"]);
    return <a href={/\.pdf$/i.test(file.name) && positiveSize(page) ? `${url}#page=${page}` : url}>{label}</a>;
  }
  if (embed && block && embedded !== null && id && key) {
    return <aside className="mn-obsidian-embed">
      {href && <a href={href}>{label}</a>}
      {renderEmbedded(embedded, { ...view, itemId: id, targets, trail: [...(view.trail ?? [view.itemId]), key] })}
    </aside>;
  }
  if (embed && !block && embedded !== null) return <q>{embedded.trim()}</q>;
  return href ? <a href={href}>{label}</a> : <span className="mn-obsidian-unresolved">{label}</span>;
}
