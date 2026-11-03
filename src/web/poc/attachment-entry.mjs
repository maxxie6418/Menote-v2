// W3b 附件往返验证入口：在 jsdom 里用真实 Milkdown 走一遍「持久化文本 → 编辑器 → 持久化文本」。
import { MilkdownWysiwygAdapter } from "../src/features/editor/milkdownAdapter.ts";
import { toEditorMarkdown, fromEditorMarkdown } from "../src/features/editor/attachmentRefs.ts";

/**
 * @param sha 附件内容哈希
 * 走真实链路：持久化文本 → toEditorMarkdown（换成鉴权 URL）→ 编辑器 → getMarkdown（现算序列化）
 * → fromEditorMarkdown（还原成相对引用）。
 */
export async function runAttachmentScenario(sha) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const names = new Map();
  try {
    const persisted = `前言。\n\n![图.png](attachments/${sha}--图.png)\n\n后语。\n`;
    const editorText = toEditorMarkdown(persisted, names);
    const adapter = await MilkdownWysiwygAdapter.create(host, {
      initialMarkdown: editorText,
      onInput: () => {},
    });
    const markdown = adapter.getMarkdown();
    const restored = fromEditorMarkdown(markdown, names);
    await adapter.destroy();
    host.remove();
    return { editorText, markdown, restored, names: [...names.entries()] };
  } catch (error) {
    return { error: String(error), stack: error instanceof Error ? error.stack : "" };
  }
}
