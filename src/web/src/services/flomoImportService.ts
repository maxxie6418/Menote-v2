/** Flomo 导入（FR-IMP-1）。
 *
 *  流程：解析导出包 → 上传图片附件 → 批量写入 Memo（保留 flomo 原始时间）→ 同步入队。
 *  每条 flomo memo 落成一条 Menote Memo：正文保留 `#标签` 原文，标签同时进 `tags` 字段供筛选，
 *  并统一追加来源标签 `#flomo`（FR-MEMO-9：标签以正文为载体）。
 *  重复导入同一个包按「创建时间 + 正文哈希」去重，不会翻倍。 */

import type { Item } from "@menote/shared";
import { appendTags, extractTags } from "@menote/shared";
import { localDb } from "../db/localDb";
import { listMemos } from "../db/itemsRepo";
import { notifyLocalChange } from "../lib/broadcast";
import { newId, sha256Hex } from "../lib/hash";
import { safeAttachmentName } from "../lib/attachmentNames";
import { attachmentHashesOf } from "../lib/attachmentRefs";
import { applyFlomoImages, parseFlomoExport, type FlomoExportData, type FlomoMemoDraft } from "../lib/flomoParse";
import { uploadAttachment } from "./attachmentService";
import { enqueueWrite, outboxUpsert } from "./contentShared";
import { recordSyncDiagnostic } from "./syncDiagnosticsService";

/** 来源标签：导入的条目统一带上，便于筛选与清理。 */
export const FLOMO_SOURCE_TAG = "flomo";

/** 每批落库的条目数：一次事务写太多会拖慢主线程，分批还能推进度。 */
const FLUSH_BATCH = 50;

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
};

export interface FlomoImportProgress {
  phase: "parsing" | "uploading" | "writing" | "done";
  done: number;
  total: number;
}

export interface FlomoImportResult {
  /** 成功写入的条数。 */
  imported: number;
  /** 因内容重复而跳过的条数。 */
  skipped: number;
  /** 内容为空（既无正文也无图片）而跳过的条数。 */
  empty: number;
  /** 写入失败的条数。 */
  failed: number;
  imagesUploaded: number;
  /** 上传失败或类型不支持而丢弃的图片数。 */
  imagesFailed: number;
  /** 解析到的总条数。 */
  total: number;
}

function imageMime(name: string): string | null {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME[extension] ?? null;
}

/** 上传一条 memo 里的图片；返回与占位符顺序一致的上传结果（失败为 null）。 */
async function uploadMemoImages(
  userId: string,
  draft: FlomoMemoDraft,
  counters: { uploaded: number; failed: number },
): Promise<Array<{ sha256: string; name: string } | null>> {
  const results: Array<{ sha256: string; name: string } | null> = [];
  for (const image of draft.images) {
    const mime = imageMime(image.name);
    if (!mime) {
      counters.failed += 1;
      results.push(null);
      continue;
    }
    const name = safeAttachmentName(image.name);
    const file = new File([image.bytes as BlobPart], name, { type: mime });
    const uploaded = await uploadAttachment(userId, file);
    if ("error" in uploaded) {
      counters.failed += 1;
      results.push(null);
      continue;
    }
    counters.uploaded += 1;
    results.push({ sha256: uploaded.sha256, name });
  }
  return results;
}

/** 批量落库：一次事务写条目与 outbox，避免逐条事务拖垮几百条导入。 */
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

/** 只解析不写入：导入面板先给用户看清条数、时间范围与标签，再决定是否导入。 */
export async function readFlomoExport(file: File): Promise<FlomoExportData> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return parseFlomoExport(bytes);
}

/** 导入 Flomo 导出包（zip）。整个过程只在本机与本账号内进行。 */
export async function importFlomoExport(
  userId: string,
  file: File,
  onProgress?: (progress: FlomoImportProgress) => void,
  parsed?: FlomoExportData,
): Promise<FlomoImportResult> {
  onProgress?.({ phase: "parsing", done: 0, total: 0 });
  const data = parsed ?? (await readFlomoExport(file));
  const total = data.memos.length;

  // 去重：已存在「同一创建时间 + 同一正文」的条目直接跳过，重复导入同一个包不会翻倍。
  const existing = await listMemos(userId, Number.MAX_SAFE_INTEGER);
  const seen = new Set(existing.map((item) => `${item.createdAt}:${item.contentHash}`));

  const result: FlomoImportResult = {
    imported: 0, skipped: 0, empty: 0, failed: 0, imagesUploaded: 0, imagesFailed: 0, total,
  };
  const counters = { uploaded: 0, failed: 0 };
  let pending: Item[] = [];

  for (let index = 0; index < data.memos.length; index += 1) {
    const draft = data.memos[index]!;
    try {
      const uploaded = await uploadMemoImages(userId, draft, counters);
      const body = appendTags(applyFlomoImages(draft.markdown, uploaded), [FLOMO_SOURCE_TAG]);
      if (!body.trim()) {
        result.empty += 1;
        continue;
      }
      const contentHash = await sha256Hex(body);
      if (seen.has(`${draft.createdAt}:${contentHash}`)) {
        result.skipped += 1;
        continue;
      }
      seen.add(`${draft.createdAt}:${contentHash}`);
      const item: Item = {
        id: newId(), userId, type: "memo", topicId: null, groupId: null,
        title: null, tags: extractTags(body), status: null, attachmentHashes: attachmentHashesOf(body), source: "external",
        rev: 1, metaRev: 1, contentHash,
        pinned: false, starred: false, createdAt: draft.createdAt, updatedAt: draft.createdAt, deletedAt: null,
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
    onProgress?.({ phase: "uploading", done: index + 1, total });
  }

  await flushItems(pending);
  result.imagesUploaded = counters.uploaded;
  result.imagesFailed = counters.failed;
  onProgress?.({ phase: "done", done: total, total });
  recordSyncDiagnostic(userId, {
    category: "local", event: "flomo_import_completed",
    action: "upsert", count: result.imported, result: `skipped:${result.skipped},failed:${result.failed}`,
  });
  return result;
}
