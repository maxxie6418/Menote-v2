/** 正文附件引用解析（FR-SYNC-7）：正文以相对路径 + 内容寻址引用 `attachments/<sha256>--<原文件名>`。
 *  纯函数放 lib 层：内容命令链路（services）与附件服务共用同一份口径，
 *  保存时据此回填条目的 attachmentHashes（服务端引用计数以此为准）。 */

const REF_PATTERN = /attachments\/([0-9a-f]{64})--([^\s)\\]+)/g;

export interface AttachmentRef {
  sha256: string;
  name: string;
}

/** 正文里引用的附件（按出现顺序，可重复）。 */
export function extractAttachmentRefs(markdown: string): AttachmentRef[] {
  const refs: AttachmentRef[] = [];
  for (const match of markdown.matchAll(REF_PATTERN)) {
    refs.push({ sha256: match[1]!, name: match[2]! });
  }
  return refs;
}

/** 正文引用到的附件哈希列表（去重，按首次出现排序）：同步载荷与引用计数的唯一来源（FR-SYNC-7）。 */
export function attachmentHashesOf(markdown: string): string[] {
  const seen = new Set<string>();
  const hashes: string[] = [];
  for (const ref of extractAttachmentRefs(markdown)) {
    if (seen.has(ref.sha256)) continue;
    seen.add(ref.sha256);
    hashes.push(ref.sha256);
  }
  return hashes;
}
