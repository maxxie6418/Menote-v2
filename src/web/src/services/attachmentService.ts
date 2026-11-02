import type { Attachment, Item } from "@menote/shared";
import { zipSync, strToU8 } from "fflate";

/** 附件与导出（G5）：上传走鉴权接口；渲染经 MarkdownView 将相对引用解析为鉴权 URL（FR-SYNC-7）。 */

const REF_PATTERN = /attachments\/([0-9a-f]{64})--([^\s)\\]+)/g;

export function extractAttachmentRefs(markdown: string): Array<{ sha256: string; name: string }> {
  const refs: Array<{ sha256: string; name: string }> = [];
  for (const match of markdown.matchAll(REF_PATTERN)) {
    refs.push({ sha256: match[1]!, name: match[2]! });
  }
  return refs;
}

export function attachmentUrl(sha256: string): string {
  return `/api/attachments/${sha256}`;
}

/** 上传附件；`onProgress` 给出 0–100 的上传进度（fetch 没有上传进度，故走 XHR）。
 *  只有请求体发完才会有进度事件，因此成功/失败都在 load 之后收尾。 */
export function uploadAttachment(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ sha256: string; name: string } | { error: string }> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/attachments");
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
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
