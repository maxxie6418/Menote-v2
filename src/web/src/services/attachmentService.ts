import { SEALED_ATTACHMENT_MIME, type AttachmentPage, type Item } from "@menote/shared";
import { notifyEditorChange, registerEditorSave } from "./editorSaveService";
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

/** 取附件原始字节（缓存优先）：缩略图生成在 UI 侧做，但网络访问必须留在 services 层。 */
export async function fetchAttachmentBlob(sha256: string): Promise<Blob | null> {
  const response = await fetch(attachmentUrl(sha256), { cache: "no-store" });
  return response.ok ? response.blob() : null;
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
  // 表格和编辑器共用上传服务；附件仍在传输时，手动同步不能误报全部完成。
  const unregister = registerEditorSave(userId, async () => false);
  notifyEditorChange();
  try {
    return await uploadAttachmentInner(userId, file, onProgress);
  } finally {
    unregister();
    notifyEditorChange();
  }
}

async function uploadAttachmentInner(
  userId: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ sha256: string; name: string } | { error: string }> {
  const policy = await readAttachmentPolicy(userId);
  const extension = file.name.split(/[\\/]/).pop()?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
  if (file.size > policy.maxBytes) return { error: "size_exceeded" };
  if (!extension || !policy.allowedExtensions.includes(extension)) return { error: "format_not_allowed" };
  return postAttachment(file, extension, onProgress);
}

/** Encrypted uploads do not send the original filename, extension or MIME. */
export function postSealedAttachment(file: File, onProgress?: (percent: number) => void) {
  return postAttachment(file, null, onProgress);
}

function postAttachment(file: File, extension: string | null, onProgress?: (percent: number) => void):
  Promise<{ sha256: string; name: string } | { error: string }> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/attachments");
    request.timeout = ATTACHMENT_UPLOAD_TIMEOUT_MS;
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    if (extension) request.setRequestHeader("X-File-Extension", `.${extension}`);
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

export async function listAttachments(cursor = ""): Promise<AttachmentPage> {
  const path = cursor ? `/api/attachments?cursor=${encodeURIComponent(cursor)}` : "/api/attachments";
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error("attachment_list_unavailable");
  const body = await response.json() as AttachmentPage | null;
  if (!body || !Array.isArray(body.attachments)) throw new Error("attachment_list_unavailable");
  return {
    attachments: body.attachments,
    ...(typeof body.nextCursor === "string" ? { nextCursor: body.nextCursor } : {}),
  };
}

/** 手动清理时同时检查本机的未同步条目与回收站引用。 */
export async function locallyReferencedAttachmentHashes(userId: string): Promise<Set<string>> {
  const items = await listUserItems(userId);
  return new Set(items.flatMap((item) => item.attachmentHashes));
}

export async function deleteAttachment(sha256: string): Promise<"deleted" | "protected" | "unavailable"> {
  try {
    const response = await fetch(`/api/attachments/${sha256}`, { method: "DELETE", cache: "no-store" });
    if (response.ok || response.status === 404) return "deleted";
    return response.status === 409 ? "protected" : "unavailable";
  } catch {
    return "unavailable";
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
async function itemMarkdown(item: Item): Promise<string> {
  const content = item.content.scope === "plain" ? item.content.markdown : "";
  if (item.type === "note") {
    const { obsidianExportMarkdown } = await import("../lib/noteProperties");
    return obsidianExportMarkdown(item);
  }
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
  if (item.content.scope !== "plain") return { ok: false, error: "locked" };
  return exportAttachmentZip(item.title ?? "memo", await itemMarkdown(item), fetchAttachmentBlob);
}

/** An export either includes every attachment or fails without producing an incomplete ZIP. */
export async function exportAttachmentZip(title: string, markdown: string,
  readAttachment: (sha256: string) => Promise<Blob | null>, canDownload = () => true,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const name = safeFilename(title);
    const files: Record<string, Uint8Array> = Object.assign(Object.create(null), { [`${name}.md`]: strToU8(markdown) });
    const bytesByHash = new Map<string, Uint8Array>();
    for (const ref of extractAttachmentRefs(markdown)) {
      if (!canDownload() || /[\/\\\u0000-\u001f]/.test(ref.name)) throw new Error("attachment_export_unavailable");
      let bytes = bytesByHash.get(ref.sha256);
      if (!bytes) {
        const blob = await readAttachment(ref.sha256);
        if (!blob || blob.type === SEALED_ATTACHMENT_MIME) throw new Error("attachment_export_unavailable");
        bytes = new Uint8Array(await blob.arrayBuffer());
        bytesByHash.set(ref.sha256, bytes);
      }
      files[`attachments/${ref.sha256}--${ref.name}`] = bytes;
    }
    if (!canDownload()) throw new Error("locked");
    const zipped = zipSync(files);
    downloadBlob(new Blob([zipped as BlobPart], { type: "application/zip" }), `${name}.zip`);
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: String(cause) };
  }
}

/** 纯 .md 导出（可选；正文附件引用将断链，调用方提示）。 */
export async function exportNoteMarkdown(item: Item): Promise<void> {
  if (item.content.scope !== "plain") return;
  const name = safeFilename(item.title ?? "memo");
  downloadBlob(new Blob([await itemMarkdown(item)], { type: "text/markdown" }), `${name}.md`);
}

/** 断链提示依据（FR-SYNC-9）。 */
export function hasAttachmentRefs(item: Item): boolean {
  return item.content.scope === "plain" && extractAttachmentRefs(item.content.markdown).length > 0;
}
