// PoC harness：在 jsdom 中创建 Milkdown 编辑器并执行 loadMarkdown → getMarkdown 往返。
// frontmatter 不进编辑器（架构保证：YAML 由属性区在编辑器外管理，FR-PROP-1 文档结构）。
import { Editor, rootCtx, defaultValueCtx } from "@milkdown/kit/core";
import { commonmark } from "@milkdown/kit/preset/commonmark";
import { gfm } from "@milkdown/kit/preset/gfm";
import { history } from "@milkdown/kit/plugin/history";
import { getMarkdown } from "@milkdown/kit/utils";

export async function roundTrip(markdown) {
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
