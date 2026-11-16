/** Flomo 导出包解析（FR-IMP-1）。
 *
 *  Flomo 官方导出是一个 zip：根目录下一层 `flomo@<用户>-<日期>/`，里面是
 *  `<用户名>的笔记.html` 与 `file/<日期>/<用户ID>/<hash>.jpg` 附件目录。
 *  HTML 里每条 memo 是一个 `div.memo`：`data-tags` 给结构化标签，`div.time` 给创建时间，
 *  `div.content` 给正文（标签以 `#标签` 原文留在正文里），`div.files` 给图片。
 *
 *  本模块是纯函数：解包 → 解析 DOM → 正文 Markdown → 待导入条目。附件上传与落库在服务层做。 */

import { unzipSync } from "fflate";
import { extractTags } from "@menote/shared";
import { nearestMemoColor } from "./memoColors";

/** 图片占位符：解析阶段只记位置，附件上传成功后替换成 `attachments/<sha>--<name>` 引用。 */
const IMAGE_PLACEHOLDER = /\{\{flomo-image:(\d+)\}\}/g;

export interface FlomoImageAsset {
  /** zip 内路径（用于回查字节）。 */
  path: string;
  /** 文件名（用作附件名）。 */
  name: string;
  bytes: Uint8Array;
}

export interface FlomoMemoDraft {
  /** flomo 原始创建时间（毫秒）。 */
  createdAt: number;
  /** 正文 Markdown：保留 `#标签` 原文，图片位置为占位符。 */
  markdown: string;
  /** 标签：优先取 `data-tags`，缺失时从正文解析。 */
  tags: string[];
  images: FlomoImageAsset[];
}

export interface FlomoExportData {
  memos: FlomoMemoDraft[];
  imageCount: number;
  /** 包里引用了但没找到的附件数。 */
  missingImages: number;
  earliest: number | null;
  latest: number | null;
  tags: string[];
}

const TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/** flomo 时间串按本地时区解析（导出的是用户本地时间，不做时区换算）。 */
export function parseFlomoTime(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second ?? "0"),
  );
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** 纯文本里的 Markdown 敏感字符做最小转义，避免 flomo 正文里的符号被当成格式。 */
function escapeText(value: string): string {
  return value.replace(/([*_`\\])/g, "\\$1");
}

function childByClass(element: Element, className: string): Element | null {
  for (const child of Array.from(element.children)) {
    if (child.classList.contains(className)) return child;
  }
  return null;
}

function elementColor(element: Element): string | null {
  const style = element.getAttribute("style") ?? "";
  const match = /color\s*:\s*([^;]+)/i.exec(style);
  if (!match) return null;
  return nearestMemoColor(match[1]!);
}

/** 行内节点转 Markdown。 */
function inlineToMarkdown(node: Node, images: FlomoImageAsset[], resolveImage: (src: string) => FlomoImageAsset | null): string {
  if (node.nodeType === 3) return escapeText(node.textContent ?? "");
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const inner = () => Array.from(element.childNodes).map((child) => inlineToMarkdown(child, images, resolveImage)).join("");
  switch (tag) {
    case "br": return "\n";
    case "strong":
    case "b": { const text = inner(); return text ? `**${text}**` : ""; }
    case "em":
    case "i": { const text = inner(); return text ? `*${text}*` : ""; }
    case "s":
    case "del":
    case "strike": { const text = inner(); return text ? `~~${text}~~` : ""; }
    case "code": { const text = element.textContent ?? ""; return text ? `\`${text}\`` : ""; }
    case "a": {
      const text = inner();
      const href = (element.getAttribute("href") ?? "").trim();
      return href ? `[${text || href}](${href})` : text;
    }
    case "img": {
      const src = (element.getAttribute("src") ?? "").trim();
      if (!src) return "";
      const asset = resolveImage(src);
      if (!asset) return "";
      images.push(asset);
      return `{{flomo-image:${images.length - 1}}}`;
    }
    case "span": {
      const text = inner();
      const color = elementColor(element);
      return color ? `<span style="color:${color}">${text}</span>` : text;
    }
    default: return inner();
  }
}

/** 列表转 Markdown（支持一层嵌套）。 */
function listToMarkdown(element: Element, images: FlomoImageAsset[], resolveImage: (src: string) => FlomoImageAsset | null, depth: number): string {
  const ordered = element.tagName.toLowerCase() === "ol";
  const items = Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li");
  return items.map((item, index) => {
    const marker = ordered ? `${index + 1}.` : "-";
    const indent = "  ".repeat(depth);
    const nested = Array.from(item.children).filter((child) => child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol");
    const own = Array.from(item.childNodes)
      .filter((child) => !(child.nodeType === 1 && ["ul", "ol"].includes((child as Element).tagName.toLowerCase())))
      .map((child) => inlineToMarkdown(child, images, resolveImage))
      .join("")
      .trim();
    const children = nested.map((child) => listToMarkdown(child, images, resolveImage, depth + 1)).join("\n");
    return `${indent}${marker} ${own}${children ? `\n${children}` : ""}`;
  }).join("\n");
}

/** 块级节点转 Markdown；返回段落数组。 */
function blockToMarkdown(node: Node, images: FlomoImageAsset[], resolveImage: (src: string) => FlomoImageAsset | null): string[] {
  if (node.nodeType === 3) {
    const text = escapeText(node.textContent ?? "").trim();
    return text ? [text] : [];
  }
  if (node.nodeType !== 1) return [];
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "p") {
    const text = Array.from(element.childNodes).map((child) => inlineToMarkdown(child, images, resolveImage)).join("").trim();
    return text ? [text] : [];
  }
  if (tag === "ul" || tag === "ol") {
    const text = listToMarkdown(element, images, resolveImage, 0);
    return text ? [text] : [];
  }
  if (tag === "blockquote") {
    const text = Array.from(element.childNodes).map((child) => inlineToMarkdown(child, images, resolveImage)).join("\n").trim();
    return text ? text.split("\n").map((line) => `> ${line}`) : [];
  }
  if (tag === "hr") return ["---"];
  if (tag === "br") return [];
  if (tag === "img") {
    const src = (element.getAttribute("src") ?? "").trim();
    if (!src) return [];
    const asset = resolveImage(src);
    if (!asset) return [];
    images.push(asset);
    return [`{{flomo-image:${images.length - 1}}}`];
  }
  return Array.from(element.childNodes).flatMap((child) => blockToMarkdown(child, images, resolveImage));
}

/** 用上传结果替换图片占位符；上传失败的图片从正文里去掉，不留断链。 */
export function applyFlomoImages(markdown: string, uploaded: Array<{ sha256: string; name: string } | null>): string {
  return markdown.replace(IMAGE_PLACEHOLDER, (whole, index: string) => {
    const asset = uploaded[Number(index)];
    if (!asset) return "";
    return `![${asset.name}](attachments/${asset.sha256}--${asset.name})`;
  }).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 解析 Flomo 导出包。
 *  `createDocument` 供测试注入 DOM 实现（浏览器里用原生 DOMParser）。
 */
export function parseFlomoExport(bytes: Uint8Array, createDocument?: (html: string) => Document): FlomoExportData {
  const entries = unzipSync(bytes);
  const htmlKeys = Object.keys(entries).filter((key) => /\.html?$/i.test(key));
  if (htmlKeys.length === 0) throw new Error("flomo_html_missing");
  htmlKeys.sort((left, right) => (entries[right]!.length ?? 0) - (entries[left]!.length ?? 0));
  const htmlKey = htmlKeys[0]!;
  const baseDir = htmlKey.includes("/") ? htmlKey.slice(0, htmlKey.lastIndexOf("/")) : "";
  const html = new TextDecoder("utf-8").decode(entries[htmlKey]!);
  const parser = createDocument ?? ((markup: string) => new DOMParser().parseFromString(markup, "text/html"));
  const document = parser(html);

  let missingImages = 0;
  const resolveImage = (src: string): FlomoImageAsset | null => {
    const cleaned = src.replace(/^\.\//, "");
    const path = baseDir ? `${baseDir}/${cleaned}` : cleaned;
    const bytes = entries[path];
    if (!bytes) {
      missingImages += 1;
      return null;
    }
    const name = cleaned.split("/").pop() ?? cleaned;
    return { path, name, bytes };
  };

  const memos: FlomoMemoDraft[] = [];
  const allTags: string[] = [];
  for (const node of Array.from(document.querySelectorAll("div.memo"))) {
    const timeText = childByClass(node, "time")?.textContent?.trim() ?? "";
    const createdAt = parseFlomoTime(timeText);
    if (createdAt === null) continue;

    const images: FlomoImageAsset[] = [];
    const content = childByClass(node, "content");
    const rawText = content?.textContent?.trim() ?? "";
    // flomo 对纯图片/空 memo 会写 `null`，按空正文处理。
    const isNull = rawText === "null";
    const blocks = isNull || !content ? [] : blockToMarkdown(content, images, resolveImage);
    const files = childByClass(node, "files");
    if (files) {
      for (const image of Array.from(files.querySelectorAll("img"))) {
        const src = (image.getAttribute("src") ?? "").trim();
        if (!src) continue;
        const asset = resolveImage(src);
        if (!asset) continue;
        images.push(asset);
        blocks.push(`{{flomo-image:${images.length - 1}}}`);
      }
    }

    const declared = node.getAttribute("data-tags");
    let tags: string[] = [];
    if (declared) {
      try {
        const parsed: unknown = JSON.parse(declared);
        if (Array.isArray(parsed)) {
          tags = parsed
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim().replace(/^#/, ""))
            .filter(Boolean);
        }
      } catch {
        tags = [];
      }
    }
    const markdown = blocks.join("\n\n");
    if (tags.length === 0) tags = extractTags(markdown);
    for (const tag of tags) if (!allTags.includes(tag)) allTags.push(tag);

    memos.push({ createdAt, markdown, tags, images });
  }

  const timestamps = memos.map((memo) => memo.createdAt);
  return {
    memos,
    imageCount: memos.reduce((sum, memo) => sum + memo.images.length, 0),
    missingImages,
    earliest: timestamps.length ? Math.min(...timestamps) : null,
    latest: timestamps.length ? Math.max(...timestamps) : null,
    tags: allTags,
  };
}
