// W2 表格命令验证入口：在 jsdom 里用真实 Milkdown 适配器执行表格命令，取回结果 markdown。
import { MilkdownWysiwygAdapter } from "../src/features/editor/milkdownAdapter.ts";

export async function runTableCommand(source, command, cellIndex = 0) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const emitted = [];
  try {
    const adapter = await MilkdownWysiwygAdapter.create(host, {
      initialMarkdown: source,
      onInput: (markdown) => { emitted.push(markdown); },
    });
    const cells = Array.from(host.querySelectorAll("td, th"));
    const cell = cells[cellIndex];
    if (!cell) {
      await adapter.destroy();
      host.remove();
      return { error: `找不到第 ${cellIndex} 个单元格（共 ${cells.length} 个）` };
    }
    const contextBefore = adapter.getTableContextAt(cell);
    const ok = adapter.runTableCommand(command, cell);
    const markdown = adapter.getMarkdown();
    const preserved = adapter.getPreservedMarkdown();
    const cellsAfter = Array.from(host.querySelectorAll("td, th"));
    const contextAfter = cellsAfter[cellIndex]
      ? adapter.getTableContextAt(cellsAfter[cellIndex])
      : null;
    await adapter.destroy();
    host.remove();
    return { ok, markdown, preserved, contextBefore, contextAfter, cellCount: cellsAfter.length, emitted: emitted[emitted.length - 1] ?? "" };
  } catch (error) {
    return { error: String(error), stack: error instanceof Error ? error.stack : "" };
  }
}
