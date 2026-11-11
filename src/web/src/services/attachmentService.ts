import type { Attachment, Item } from "@menote/shared";
import { zipSync, strToU8 } from "fflate";
import { listUserItems } from "../db/itemsRepo";
import { appRoutePath } from "../app/appRoutes";
import { extractAttachmentRefs } from "../lib/attachmentRefs";
import { readAttachmentPolicy } from "./attachmentPolicyService";

/** 附件与导出（G5）：上传走鉴权接口；渲染经 MarkdownView 将相对引用解析为鉴权 URL（FR-SYNC-7）。 */

export { extractAttachmentRefs };

export function attachmentUrl(sha256: string): string {
  return `/api/attachments/${sha256}`;
}

/* ---------- 表格附件缩略图（UI 层禁止直连网络，AGENTS §3）：取图并压成数据 URL，失败回落原图 ---------- */

const THUMBNAIL_MAX_EDGE = 96;
const THUMBNAIL_CACHE_LIMIT = 256;
const thumbnailCache = new Map<string, string>();

function rememberThumbnail(sha256: string, dataUrl: string): void {
  if (thumbnailCache.has(sha256)) thumbnailCache.delete(sha256);
  thumbnailCache.set(sha256, dataUrl);
  if (thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
    const first = thumbnailCache.keys().next().value;
    if (first) thumbnailCache.delete(first);
  }
}

/** 已缓存的缩略图数据 URL；未命中返回空串（调用方先渲染占位）。 */
export function cachedAttachmentThumbnail(sha256: string): string {
  return thumbnailCache.get(sha256) ?? "";
}

/** 取附件缩略图：命中缓存直接返回；否则下载原图、等比压边、转 webp 数据 URL 并入缓存。
 *  位图缩放不可用或请求失败时回落原图 URL（由 CSS 控制显示尺寸）。 */
export async function readAttachmentThumbnail(sha256: string): Promise<string> {
  const cached = thumbnailCache.get(sha256);
  if (cached) return cached;
  try {
    const response = await fetch(attachmentUrl(sha256), { cache: "force-cache" });
    if (!response.ok) return attachmentUrl(sha256);
    const bitmap = await createImageBitmap(await response.blob());
    const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) { bitmap.close(); return attachmentUrl(sha256); }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.48));
    if (!blob) return attachmentUrl(sha256);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("thumbnail_read_failed"));
      reader.onerror = () => reject(reader.error ?? new Error("thumbnail_read_failed"));
      reader.readAsDataURL(blob);
    });
    rememberThumbnail(sha256, dataUrl);
    return dataUrl;
  } catch {
    return attachmentUrl(sha256);
  }
}

export interface AttachmentReference { id: string; title: string; href: string }
export interface AttachmentDetails { name: string; references: AttachmentReference[] }
export async function listAttachmentReferences(userId: string): Promise<Record<string, AttachmentDetails>> {
  const items = await listUserItems(userId);
  const references: Record<string, AttachmentDetails> = {};
  for (const item of items) {
    if (item.deletedAt !== null || item.content.scope !== "plain") continue;
    const seen = new Set<string>();
    for (const ref of extractAttachmentRefs(item.content.markdown)) {
      if (seen.has(ref.sha256)) continue;
      seen.add(ref.sha256);
      const detail = (references[ref.sha256] ??= { name: ref.name, references: [] });
      detail.references.push({
        id: item.id,
        title: item.type === "memo" ? `Memo · ${new Date(item.createdAt).toLocaleString()}` : item.title,
        href: item.type === "memo" ? `/memos/${encodeURIComponent(item.id)}` : appRoutePath({ kind: "notes", section: { kind: "recent" }, itemId: item.id }),
      });
    }
  }
  return references;
}

/** 上传附件；`onProgress` 给出 0–100 的上传进度（fetch 没有上传进度，故走 XHR）。
 *  只有请求体发完才会有进度事件，因此成功/失败都在 load 之后收尾。 */
export const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120_000;

export async function uploadAttachment(
  userId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ sha256: string; name: string } | { error: string }> {
  const policy = await readAttachmentPolicy(userId);
  const extension = file.name.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
  if (file.size > policy.maxBytes) return { error: "size_exceeded" };
  if (!extension || !policy.allowedExtensions.includes(extension)) return { error: "format_not_allowed" };
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/attachments");
    request.timeout = ATTACHMENT_UPLOAD_TIMEOUT_MS;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    request.setRequestHeader("X-File-Extension", `.${extension}`);
    request.upload.onprogress = (event) => {
      if (!onProgress || !event.lengthComputable || event.total === 0) return;
      onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    request.onload = () => {
      let body: unknown = null;
      try { body = JSON.parse(request.responseText); } catch { body = null; }
      const sha256 = (body as { sha256?: unknown } | null)?.sha256;
      if (request.status >= 200 && request.status < 300 && typeof sha256 === "string") {
        onProgress?.(100);
        resolve({ sha256, name: file.name });
        return;
      }
      const code = (body as { error?: unknown } | null)?.error;
      resolve({ error: typeof code === "string" ? code : `http_${request.status}` });
    };
    request.onerror = () => resolve({ error: "network" });
    request.onabort = () => resolve({ error: "aborted" });
    request.ontimeout = () => resolve({ error: "timeout" });
    request.send(file);
  });
}

export async function listAttachments(userId: string): Promise<Attachment[]> {
  void userId;
  const response = await fetch("/api/attachments", { cache: "no-store" });
  if (!response.ok) return [];
  const body: unknown = await response.json();
  const attachments = (body as { attachments?: unknown } | null)?.attachments;
  return Array.isArray(attachments) ? (attachments as Attachment[]) : [];
}

/** 删除未引用附件（FR-SYNC-8）；服务端校验引用计数。 */
export async function deleteAttachment(sha256: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/attachments/${sha256}`, { method: "DELETE", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

function safeFilename(title: string): string {
  return title.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60) || "note";
}

/** Memo 导出按约定生成 YAML + Markdown；Note 保持原始 .md（FR-SYNC-6）。 */
function itemMarkdown(item: Item): string {
  const content = item.content.scope === "plain" ? item.content.markdown : "";
  if (item.type !== "memo") return content;
  const front = [
    "---",
    `id: ${JSON.stringify(item.id)}`,
    `tags: [${item.tags.map((tag) => JSON.stringify(tag)).join(", ")}]`,
    `status: ${item.status === null ? "null" : JSON.stringify(item.status)}`,
    `created: ${JSON.stringify(new Date(item.createdAt).toISOString())}`,
    "---",
  ].join("\n");
  return `${front}\n\n${content}`;
}

/** 单篇导出 zip（FR-SYNC-9）：.md + attachments/ 仅含被引用附件，解压即完整可读。 */
export async function exportNoteZip(userId: string, item: Item): Promise<{ ok: true } | { ok: false; error: string }> {
  void userId;
  try {
    const markdown = itemMarkdown(item);
    const name = safeFilename(item.title ?? "memo");
    const files: Record<string, Uint8Array> = { [`${name}.md`]: strToU8(markdown) };
    for (const ref of extractAttachmentRefs(markdown)) {
      const response = await fetch(attachmentUrl(ref.sha256), { cache: "no-store" });
      if (!response.ok) continue;
      files[`attachments/${ref.sha256}--${ref.name}`] = new Uint8Array(await response.arrayBuffer());
    }
    const zipped = zipSync(files);
    downloadBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), `${name}.zip`);
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: String(cause) };
  }
}

/** 纯 .md 导出（可选；正文附件引用将断链，调用方提示）。 */
export function exportNoteMarkdown(item: Item): void {
  const name = safeFilename(item.title ?? "memo");
  downloadBlob(new Blob([itemMarkdown(item)], { type: "text/markdown" }), `${name}.md`);
}

/** 断链提示依据（FR-SYNC-9）。 */
export function hasAttachmentRefs(item: Item): boolean {
  return item.content.scope === "plain" && extractAttachmentRefs(item.content.markdown).length > 0;
}
