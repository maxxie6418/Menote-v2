/** 随记标签正文化（FR-MEMO-9）：标签以 `#标签` 文本存在于正文，`tags` 字段是从正文解析出来的索引。
 *  前后端共用同一份口径：Web 保存 Memo 与 Worker MCP 建 Memo 都走这里，避免两端解析规则漂移。 */

/** 标签语法：`#` 紧跟非空白字符。
 *  `#` 前面若是 ASCII 字母、数字或路径字符就不算标签，因此 URL 锚点（`example.com#a`）与 `C#` 不会误判；
 *  Markdown 标题（`# 标题`）因 `#` 后有空格也不成立。 */
const TAG_PATTERN = /(?<![A-Za-z0-9/.\-])#([^\s#]+)/g;

/** 标签名尾部的中英文标点不算标签的一部分（`#工作。` → `工作`）。 */
const TRAILING_PUNCTUATION = /[.,;:!?、，。；：！？）)\]】」』"'“”‘’]+$/;

/** 标签在原文中的位置；展示层可用它强调标签，同时保留原始正文文本。 */
export function findMemoTagRanges(text: string): Array<{ name: string; start: number; end: number }> {
  const ranges: Array<{ name: string; start: number; end: number }> = [];
  for (const match of text.matchAll(TAG_PATTERN)) {
    const name = match[1]!.replace(TRAILING_PUNCTUATION, "").trim();
    if (!name) continue;
    const start = match.index ?? 0;
    ranges.push({ name, start, end: start + 1 + name.length });
  }
  return ranges;
}

/** 正文里的标签（按出现顺序去重）。 */
export function extractTags(markdown: string): string[] {
  const tags: string[] = [];
  for (const { name } of findMemoTagRanges(markdown)) {
    if (tags.includes(name)) continue;
    tags.push(name);
  }
  return tags;
}

/** 把给定标签补进正文末尾；正文里已有的标签不重复追加。正文是标签的唯一载体。 */
export function appendTags(markdown: string, tags: string[]): string {
  const present = new Set(extractTags(markdown));
  const missing: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, "");
    if (!tag || present.has(tag)) continue;
    present.add(tag);
    missing.push(tag);
  }
  if (missing.length === 0) return markdown;
  const body = markdown.replace(/\s+$/, "");
  const line = missing.map((tag) => `#${tag}`).join(" ");
  return body ? `${body}\n\n${line}` : line;
}

/** 标签文本的匹配式：`#标签` 整体匹配，后面不再跟字母数字（避免 `#工作` 命中 `#工作坊`），
 *  尾部标点（`#工作。`）允许存在。 */
function tagTokenPattern(tag: string): RegExp {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9/.\\-])#${escaped}(?![\\p{L}\\p{N}_])`, "gu");
}

/** 从正文里去掉某个标签文本（去掉后不留多余空格）。 */
export function removeTagFromText(text: string, tag: string): string {
  const name = tag.trim().replace(/^#/, "");
  if (!name) return text;
  return text.replace(tagTokenPattern(name), "").replace(/[ \t]{2,}/g, " ").trimEnd();
}

/** 正文里的标签改名（`#旧` → `#新`）。 */
export function renameTagInText(text: string, oldTag: string, newTag: string): string {
  const from = oldTag.trim().replace(/^#/, "");
  const to = newTag.trim().replace(/^#/, "");
  if (!from || !to || from === to) return text;
  return text.replace(tagTokenPattern(from), `#${to}`);
}

/** 把正文里的标签整组替换成给定标签（先清掉原有标签文本，再按新标签补齐）。 */
export function setTagsInText(text: string, tags: string[]): string {
  const stripped = extractTags(text).reduce((current, tag) => removeTagFromText(current, tag), text);
  return appendTags(stripped, tags);
}

/** 正文里已有该标签就移除第一处，否则追加到末尾；供「点标签即写入正文」的快捷入口使用。 */
export function toggleTagInText(text: string, tag: string): string {
  const name = tag.trim().replace(/^#/, "");
  if (!name) return text;
  if (extractTags(text).includes(name)) return removeTagFromText(text, name);
  const body = text.replace(/\s+$/, "");
  return body ? `${body} #${name}` : `#${name}`;
}
