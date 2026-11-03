// W3b 接入验证入口（FR-EDT-10）：键入路径不再整篇序列化。
// 1) 改一处正文（真实 doc 变化），确认**没有**触发序列化器；
// 2) 确认脏信号（onInput）会被发出——注意 listener 的 `updated` 条件是
//    `prevDoc && !prevDoc.eq(doc)`，首次变更可能不触发，所以正文新鲜度靠 doc 比较；
// 3) 在防抖窗口（200ms）内立刻取持久化文本，确认拿到的是新内容而不是旧缓存；
// 4) 「/」菜单上下文走原生选区，不整篇序列化。
import { MilkdownWysiwygAdapter } from "../src/features/editor/milkdownAdapter.ts";
import { perfProbe } from "../src/lib/perfProbe.ts";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 指标桶名列表（探针默认关闭，这里显式打开）。 */
const bucketNames = () => perfProbe.summary().map((row) => row.name);

/**
 * 场景：创建 → 选一段加粗（doc 真变了）→ 防抖窗口内取持久化文本 → 等防抖过去看指标。
 */
export async function runTypingScenario(source = "abc def\n") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let dirtyCount = 0;
  try {
    const adapter = await MilkdownWysiwygAdapter.create(host, {
      initialMarkdown: source,
      onInput: () => { dirtyCount += 1; },
    });
    perfProbe.enable();
    perfProbe.reset();
    // 模拟一次按键（适配器在 keydown 记起点）。
    host.dispatchEvent(new window.KeyboardEvent("keydown", { key: "b", bubbles: true }));
    // 改动正文：选中前三个字符加粗——真实 doc 变化，走的是编辑器的正常提交路径。
    adapter.setSelection(0, 3);
    const applied = adapter.applyFormat("bold");
    // 关键证据：此刻 listener 的 200ms 防抖还没到，序列化器**不该**被调用过。
    const bucketsAfterEdit = bucketNames();
    // 防抖窗口内立刻取持久化文本：必须已经是新内容（靠 doc 比较判新鲜度）。
    const preservedImmediately = adapter.getPreservedMarkdown();
    const bucketsAfterPreserved = bucketNames();
    const markdownAfterEdit = adapter.getMarkdown();
    // 等防抖窗口过去，看脏信号与「按键 → 变更被感知」指标。
    await sleep(400);
    const dirtyCountAfterDebounce = dirtyCount;
    const bucketsAfterDebounce = bucketNames();
    await adapter.destroy();
    host.remove();
    return {
      applied,
      dirtyCount,
      dirtyCountAfterDebounce,
      preservedImmediately,
      markdownAfterEdit,
      bucketsAfterEdit,
      bucketsAfterPreserved,
      bucketsAfterDebounce,
    };
  } catch (error) {
    return { error: String(error), stack: error instanceof Error ? error.stack : "" };
  }
}

/** 场景：光标放在某处，问「/」菜单上下文（不整篇序列化）。 */
export async function runSlashScenario(source, offset) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  try {
    const adapter = await MilkdownWysiwygAdapter.create(host, {
      initialMarkdown: source,
      onInput: () => {},
    });
    adapter.setSelection(offset, offset);
    const context = adapter.getSlashContext();
    await adapter.destroy();
    host.remove();
    return { context };
  } catch (error) {
    return { error: String(error), stack: error instanceof Error ? error.stack : "" };
  }
}
