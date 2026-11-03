// W1 接入验证入口：
// 1) 用真实 Milkdown 把「编辑后的文档」规范化（拿到序列化器改写后的文本）；
// 2) 交给真实适配器走本地提交路径；
// 3) 取持久化文本，验证未触碰的块回填了原始字节。
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { getMarkdown } from "@milkdown/kit/utils";
import { MilkdownWysiwygAdapter } from "../src/features/editor/milkdownAdapter.ts";

/** 真实 Milkdown 规范化：序列化器会把列表符号、表格分隔行等改写。 */
async function canonicalize(markdown) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .create();
  const output = editor.action(getMarkdown());
  await editor.destroy();
  host.remove();
  return output;
}

export async function guardRoundTrip(source, editedSource) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  // onInput 是脏信号（FR-EDT-10）：只表示「正文变了」，不再带正文。
  let dirtyCount = 0;
  const steps = {};
  try {
    const canonicalEdited = await canonicalize(editedSource);
    steps.canonicalEdited = canonicalEdited;
    const adapter = await MilkdownWysiwygAdapter.create(host, {
      initialMarkdown: source,
      onInput: () => { dirtyCount += 1; },
    });
    steps.created = true;
    // 选区换算：光标落在列表内部时，doc.cut 会触发 Milkdown gfm 序列化器缺陷（既有缺陷，需兜底）。
    steps.selection = adapter.getSelection();
    adapter.setSelection(3, 3);
    steps.setSelection = true;
    // 本地提交路径（插入附件、源码变换走的就是这条）。
    adapter.loadMarkdown(canonicalEdited, { keepBaseline: true });
    steps.submitted = true;
    const canonical = adapter.getMarkdown();
    const preserved = adapter.getPreservedMarkdown();
    const sameCanonical = adapter.isSameContent(canonical);
    const samePreserved = adapter.isSameContent(preserved);
    await adapter.destroy();
    host.remove();
    return { canonical, preserved, sameCanonical, samePreserved, dirtyCount, steps };
  } catch (error) {
    return { error: String(error), stack: error instanceof Error ? error.stack : "", steps };
  }
}
