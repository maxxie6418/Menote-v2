/** Obsidian 导入解析（FR-IMP-2）。纯函数：给定扫描到的文件清单，产出笔记草稿与摘要。
 *
 *  口径（负责人 2026-11-18 确认）：
 *  - 标题取文件名（去扩展名）；正文（含 YAML frontmatter）原样保留，属性面板按既有口径读取属性；
 *  - 图片引用两种写法都解析：Wiki 嵌入 `![[名称.ext]]` 与标准 `![](相对路径)`；
 *    先按笔记所在目录的相对路径解析，失败再按全库文件名索引解析（Obsidian「最短路径」语义）；
 *  - 解析不到的引用不静默丢弃：保留原文，标记缺失，由预览与结果明示。 */

export interface ObsidianScannedFile {
  /** 以扫描根为基准的相对路径，统一用 `/` 分隔。 */
  path: string;
  file: File;
}

/** 一篇 Obsidian 笔记的解析结果：只存元数据，正文在导入时从 file 再读，避免预览阶段占内存。 */
export interface ObsidianNoteDraft {
  path: string;
  file: File;
  title: string;
  /** 文件修改时间（毫秒），作为导入后的创建/更新时间。 */
  mtime: number;
  /** 去除空白后的字符数（中英文同口径，仅作预览参考）。 */
  characters: number;
  /** 按出现顺序的图片引用；`resolvedPath` 为解析到的扫描内图片路径，null 表示解析不到。 */
  images: ObsidianImageRef[];
}

export interface ObsidianImageRef {
  /** 正文里的原始写法（用于缺图时原样保留）。 */
  raw: string;
  /** 引用的目标（wiki 名或相对路径，URL 已解码）。 */
  target: string;
  /** 重写时的替换 alt 文本：wiki 取目标名（去扩展名），标准链接取原 alt。 */
  alt: string;
  resolvedPath: string | null;
}

export interface ObsidianScanSummary {
  /** 扫描根（目录名或「所选文件」）。 */
  rootLabel: string;
  /** 是否识别为整库（根目录含 .obsidian）。 */
  isVault: boolean;
  notes: number;
  images: number;
  /** 跳过的其它文件数（含隐藏目录内容）。 */
  skipped: number;
  /** 解析不到的图片引用总数（按引用次数计）。 */
  missingImageRefs: number;
  totalBytes: number;
}

export interface ObsidianScanData {
  summary: ObsidianScanSummary;
  /** 解析出的笔记候选，按路径排序。 */
  drafts: ObsidianNoteDraft[];
  /** 扫描到的图片候选，路径 → 文件。 */
  imageFiles: Map<string, File>;
}

/** 附件策略默认允许的图片类型（attachmentPolicyService 口径）；svg 默认不允许，按其它文件跳过。 */
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp"]);

/** Wiki 嵌入：`![[name.png]]` / `![[path/name.png|200]]`（`|` 后为尺寸参数，解析时忽略）。 */
const WIKI_EMBED_PATTERN = /!\[\[([^\]|\n]+)(?:\|[^\]]*)?\]\]/g;
/** 标准 Markdown 图片：`![alt](path)`；外链 http(s)/data: 不解析。 */
const MD_IMAGE_PATTERN = /!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

const MD_EXTENSIONS = /\.(md|markdown)$/i;

function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** 路径段里以 `.` 开头的目录（.obsidian / .trash / .git …）与其文件一律跳过。 */
function isHiddenPath(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith("."));
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/{2,}/g, "/");
}

function parentDirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** 统计图片引用：wiki 与标准两种写法，逐个按解析器给定的查找函数定位。 */
function extractImageRefs(markdown: string, resolve: (target: string) => string | null): ObsidianImageRef[] {
  const refs: ObsidianImageRef[] = [];
  const seen = new Set<string>();
  for (const [pattern, wiki] of [[WIKI_EMBED_PATTERN, true], [MD_IMAGE_PATTERN, false]] as const) {
    for (const match of markdown.matchAll(pattern)) {
      const raw = match[0]!;
      const target = decodeTarget((wiki ? match[1] : match[2])!.trim());
      if (!target || /^(https?:|data:)/i.test(target)) continue;
      if (seen.has(raw)) continue;
      seen.add(raw);
      const alt = wiki
        ? basenameOf(target).replace(/\.[a-z0-9]+$/i, "")
        : match[1] ?? "";
      refs.push({ raw, target, alt, resolvedPath: resolve(target) });
    }
  }
  return refs;
}

export interface ObsidianParseOptions {
  rootLabel: string;
}

/** 解析扫描清单：分类笔记与图片、建全库文件名索引。正文逐篇读入由 finalize 驱动。 */
export function parseObsidianFiles(files: ObsidianScannedFile[], options: ObsidianParseOptions): ObsidianScanData {
  const summary: ObsidianScanSummary = {
    rootLabel: options.rootLabel, isVault: false,
    notes: 0, images: 0, skipped: 0, missingImageRefs: 0, totalBytes: 0,
  };
  const mdFiles: ObsidianScannedFile[] = [];
  const imageFiles = new Map<string, File>();
  const nameIndex = new Map<string, string>();

  for (const entry of files) {
    const path = normalizePath(entry.path);
    const hidden = isHiddenPath(path);
    if (hidden) {
      // 整库识别：存在 .obsidian 配置目录即视为 Obsidian 库（其内容本身仍跳过）。
      if (path.split("/").some((segment) => segment === ".obsidian")) summary.isVault = true;
      else summary.skipped += 1;
      continue;
    }
    summary.totalBytes += entry.file.size;
    const extension = extensionOf(basenameOf(path));
    if (MD_EXTENSIONS.test(basenameOf(path))) {
      mdFiles.push({ path, file: entry.file });
      continue;
    }
    if (IMAGE_EXTENSIONS.has(extension)) {
      imageFiles.set(path, entry.file);
      const lower = path.toLowerCase();
      if (!nameIndex.has(lower)) nameIndex.set(lower, path);
      continue;
    }
    summary.skipped += 1;
  }

  summary.notes = mdFiles.length;
  summary.images = imageFiles.size;
  const drafts: ObsidianNoteDraft[] = mdFiles.map((entry) => ({
    path: entry.path,
    file: entry.file,
    title: basenameOf(entry.path).replace(MD_EXTENSIONS, "").trim() || "无标题",
    mtime: entry.file.lastModified,
    characters: 0,
    images: [],
  }));
  return { summary, drafts, imageFiles };
}

export type ObsidianRefResolver = (noteDir: string, target: string) => string | null;

/** 基于一次扫描结果构造引用解析器：①笔记目录下的相对路径；②扫描根下的相对路径；③全库按文件名查（Obsidian「最短路径」语义，不分大小写）。 */
export function makeObsidianResolver(data: Pick<ObsidianScanData, "imageFiles">): ObsidianRefResolver {
  const byName = new Map<string, string>();
  for (const path of data.imageFiles.keys()) {
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    if (!byName.has(name)) byName.set(name, path);
  }
  return (noteDir: string, target: string): string | null => {
    const clean = normalizePath(target);
    for (const base of [noteDir, ""]) {
      const joined = normalizePath(base ? `${base}/${clean}` : clean);
      if (data.imageFiles.has(joined)) return joined;
    }
    return byName.get(clean.slice(clean.lastIndexOf("/") + 1).toLowerCase()) ?? null;
  };
}

/** 逐篇读正文补全解析（字数与图片引用需要读文本；由服务层逐条驱动控制内存）。 */
export async function finalizeObsidianDraft(draft: ObsidianNoteDraft, resolve: ObsidianRefResolver): Promise<ObsidianNoteDraft> {
  const markdown = await draft.file.text();
  const noteDir = parentDirOf(draft.path);
  const images = extractImageRefs(markdown, (target) => resolve(noteDir, target));
  return {
    ...draft,
    characters: markdown.replace(/\s/g, "").length,
    images,
  };
}

/** 统计摘要里解析不到的图片引用次数。 */
export function countMissingImages(drafts: ObsidianNoteDraft[]): number {
  return drafts.reduce((total, draft) => total + draft.images.filter((ref) => ref.resolvedPath === null).length, 0);
}
