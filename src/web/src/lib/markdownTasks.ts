/** 任务复选框与正文的互写（FR-MEMO-3）：第 N 个任务在源文本中改写 `[ ]`/`[x]`；引用前缀一并识别。 */
const TASK_LINE = /^((?:\s|>)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

export function countTaskCheckboxes(markdown: string): number {
  return markdown.split(/\r?\n/).filter((line) => TASK_LINE.test(line)).length;
}

/** 设定第 ordinal 个（0 起）任务复选框状态；越界原样返回。 */
export function setTaskCheckbox(markdown: string, ordinal: number, checked: boolean): string {
  let index = -1;
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!TASK_LINE.test(line)) continue;
    index += 1;
    if (index !== ordinal) continue;
    lines[i] = line.replace(TASK_LINE, `$1${checked ? "x" : " "}$3`);
    return lines.join("\n");
  }
  return markdown;
}
