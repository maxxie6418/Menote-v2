export function decodeGfmTableRow(line: string): string[] {
  // 按未转义竖线切分；连续反斜线按 GFM 奇偶规则处理。
  const trimmed = line.trim();
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i]!;
    if (char === "\\") {
      let end = i;
      while (trimmed[end + 1] === "\\") end += 1;
      const count = end - i + 1;
      if (trimmed[end + 1] === "|") {
        current += "\\".repeat(Math.floor(count / 2));
        if (count % 2) current += "|";
        else { cells.push(current); current = ""; }
        i = end + 1;
        continue;
      }
      current += "\\".repeat(count);
      i = end;
      continue;
    }
    if (char === "|") { cells.push(current); current = ""; continue; }
    current += char;
  }
  cells.push(current);
  if (trimmed.startsWith("|")) cells.shift();
  let trailingSlashes = 0;
  for (let index = trimmed.length - 2; index >= 0 && trimmed[index] === "\\"; index -= 1) trailingSlashes += 1;
  if (trimmed.endsWith("|") && trailingSlashes % 2 === 0) cells.pop();
  return cells.map((cell) => cell.trim());
}

export function escapeGfmTablePipes(value: string): string {
  return value.replace(/(\\*)\|/g, (_, slashes: string) => slashes + slashes + "\\|");
}
