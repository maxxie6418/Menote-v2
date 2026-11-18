/** Obsidian 导入服务（FR-IMP-2）。
 *
 *  流程：扫描读取（lib/obsidianScan）→ 解析（lib/obsidianParse）→ 面板勾选 → 上传图片附件 →
 *  批量写入 Note（文件修改时间作为创建/更新时间，YAML frontmatter 原样保留进属性面板）→ 同步入队。
 *  解析与读取全部在本机完成，文件内容不上传任何服务器；只有被引用且勾选的图片会作为附件上传。
 *  重复导入按「标题 + 正文哈希」去重；单条失败不中断整批。 */

import type { Item, TopicNode } from "@menote/shared";
import { localDb } from "../db/localDb";
import { listUserItems } from "../db/itemsRepo";
import { listTopics } from "../db/topicsRepo";
import { notifyLocalChange } from "../lib/broadcast";
import { newId, sha256Hex } from "../lib/hash";
import { safeAttachmentName } from "../lib/attachmentNames";
import { attachmentHashesOf } from "../lib/attachmentRefs";
import {
  countMissingImages, finalizeObsidianDraft, makeObsidianResolver,
  parseObsidianFiles, type ObsidianNoteDraft, type ObsidianRefResolver,
  type ObsidianScanData, type ObsidianScannedFile,
} from "../lib/obsidianParse";
import { uploadAttachment } from "./attachmentService";
import { enqueueWrite, outboxUpsert } from "./contentShared";
import { recordSyncDiagnostic } from "./syncDiagnosticsService";

/** 每批落库的条目数（与 Flomo 导入同口径）。 */
const FLUSH_BATCH = 50;

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export interface ObsidianImportProgress {
  phase: "reading" | "uploading" | "writing" | "done";
  done: number;
  total: number;
}

export interface ObsidianImportResult {
  /** 成功写入的笔记数。 */
  imported: number;
  /** 因「标题 + 正文哈希」重复而跳过的条数。 */
  skipped: number;
  /** 正文与图片均为空而跳过的条数。 */
  empty: number;
  /** 写入失败的条数。 */
  failed: number;
  imagesUploaded: number;
  /** 上传失败或类型不支持而丢弃的图片数。 */
  imagesFailed: number;
  /** 解析不到对应图片文件的引用次数（正文保留原文，未静默丢弃）。 */
  unresolvedRefs: number;
  /** 本次实际导入的笔记数（勾选数）。 */
  total: number;
}

/** 导入目标：收件箱（两者皆 null）或主题/分组。 */
export interface ObsidianImportTarget {
  topicId: string | null;
  groupId: string | null;
}

/** 导入目标候选：排除私人空间（导入笔记须明文落收件箱/普通主题）。 */
export async function listImportTargets(userId: string): Promise<TopicNode[]> {
  const topics = await listTopics(userId);
  return topics.filter((topic) => topic.deletedAt === null && !topic.isEncSpace);
}

/** 读取并解析一个扫描来源：分类文件、逐篇读正文提取图片引用。文件只读本机内存。 */
export async function readObsidianSource(
  files: ObsidianScannedFile[],
  rootLabel: string,
  onProgress?: (progress: ObsidianImportProgress) => void,
): Promise<ObsidianScanData> {
  onProgress?.({ phase: "reading", done: 0, total: 0 });
  const data = parseObsidianFiles(files, { rootLabel });
  const resolve = makeObsidianResolver(data);
  for (let index = 0; index < data.drafts.length; index += 1) {
    data.drafts[index] = await finalizeObsidianDraft(data.drafts[index]!, resolve);
    onProgress?.({ phase: "reading", done: index + 1, total: data.drafts.length });
  }
  data.summary.missingImageRefs = countMissingImages(data.drafts);
  return data;
}

/** 上传一张扫描到的图片；失败返回 null 并计数。 */
async function uploadScannedImage(
  userId: string,
  file: File,
  counters: { uploaded: number; failed: number },
): Promise<{ sha256: string; name: string } | null> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = IMAGE_MIME[extension];
  if (!mime) { counters.failed += 1; return null; }
  const name = safeAttachmentName(file.name);
  const upload = await uploadAttachment(userId, new File([file], name, { type: mime }));
  if ("error" in upload) { counters.failed += 1; return null; }
  counters.uploaded += 1;
  return { sha256: upload.sha256, name };
}

/** 批量落库（与 Flomo 导入同口径）：一次事务写条目与 outbox。 */
async function flushItems(items: Item[]): Promise<void> {
  if (items.length === 0) return;
  const rows = items.map((item) => outboxUpsert(item, 0, 0, item.contentHash));
  await enqueueWrite(async () => {
    await localDb.transaction("rw", localDb.items, localDb.outbox, async () => {
      await localDb.items.bulkPut(items);
      await localDb.outbox.bulkAdd(rows);
    });
  });
  notifyLocalChange();
}

/** 正文重写：解析到的引用换附件引用（保留 alt），解析不到的原文保留。 */
function rewriteBody(markdown: string, draft: ObsidianNoteDraft, uploaded: Map<string, { sha256: string; name: string } | null>): string {
  let body = markdown;
  for (const ref of draft.images) {
    if (ref.resolvedPath === null) continue;
    const image = uploaded.get(ref.resolvedPath);
    if (!image) continue;
    body = body.replace(ref.raw, `![${ref.alt}](attachments/${image.sha256}--${image.name})`);
  }
  return body;
}

/** 导入勾选的 Obsidian 笔记。整个过程只在本机与本账号内进行。 */
export async function importObsidianNotes(
  userId: string,
  data: ObsidianScanData,
  selectedPaths: ReadonlySet<string>,
  target: ObsidianImportTarget,
  onProgress?: (progress: ObsidianImportProgress) => void,
): Promise<ObsidianImportResult> {
  const drafts = data.drafts.filter((draft) => selectedPaths.has(draft.path));
  const total = drafts.length;
  onProgress?.({ phase: "uploading", done: 0, total });

  // 去重：已存在「同标题 + 同正文哈希」的笔记直接跳过，重复导入不会翻倍。
  const existing = await listUserItems(userId);
  const seen = new Set(existing
    .filter((item) => item.type !== "memo" && item.deletedAt === null)
    .map((item) => `${item.title}:${item.contentHash}`));

  const resolve = makeObsidianResolver(data);
  const uploaded = new Map<string, { sha256: string; name: string } | null>();
  const counters = { uploaded: 0, failed: 0 };
  const result: ObsidianImportResult = {
    imported: 0, skipped: 0, empty: 0, failed: 0,
    imagesUploaded: 0, imagesFailed: 0, unresolvedRefs: 0, total,
  };
  let pending: Item[] = [];

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index]!;
    try {
      const markdown = await draft.file.text();
      // 图片先传后写：只上传该篇引用到且解析成功的图片（跨篇共享同一上传缓存，同名文件只传一次）。
      for (const ref of draft.images) {
        if (ref.resolvedPath === null) { result.unresolvedRefs += 1; continue; }
        if (!uploaded.has(ref.resolvedPath)) {
          const file = data.imageFiles.get(ref.resolvedPath);
          uploaded.set(ref.resolvedPath, file
            ? await uploadScannedImage(userId, file, counters)
            : null);
        }
      }
      const body = rewriteBody(markdown, draft, uploaded);
      if (!body.trim()) { result.empty += 1; continue; }
      const contentHash = await sha256Hex(body);
      if (seen.has(`${draft.title}:${contentHash}`)) { result.skipped += 1; continue; }
      seen.add(`${draft.title}:${contentHash}`);
      const item: Item = {
        id: newId(), userId, type: "note",
        topicId: target.topicId, groupId: target.groupId,
        title: draft.title, tags: [], status: null,
        attachmentHashes: attachmentHashesOf(body), source: "external",
        rev: 1, metaRev: 1, contentHash,
        pinned: false, starred: false, createdAt: draft.mtime, updatedAt: draft.mtime, deletedAt: null,
        content: { scope: "plain", markdown: body },
      };
      pending.push(item);
      result.imported += 1;
      if (pending.length >= FLUSH_BATCH) {
        await flushItems(pending);
        pending = [];
      }
    } catch {
      result.failed += 1;
    }
    onProgress?.({ phase: "writing", done: index + 1, total });
  }

  await flushItems(pending);
  result.imagesUploaded = counters.uploaded;
  result.imagesFailed = counters.failed;
  onProgress?.({ phase: "done", done: total, total });
  recordSyncDiagnostic(userId, {
    category: "local", event: "obsidian_import_completed",
    action: "upsert", count: result.imported,
    result: `skipped:${result.skipped},failed:${result.failed},unresolved:${result.unresolvedRefs}`,
  });
  return result;
}

/** 供面板做引用解析的自查（预览缺图标记与导入共用同一解析器口径）。 */
export type { ObsidianRefResolver };
