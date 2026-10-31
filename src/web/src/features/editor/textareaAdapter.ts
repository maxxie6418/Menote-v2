import type { EditorAdapter } from "./EditorAdapter";

/**
 * [实施定] E2 选型：等宽 textarea（非 CodeMirror）——M2 源码形态是临时形态（FR-EDT-1 定稿
 * M3 落 WYSIWYG），原生输入法/撤销/选区行为零集成风险且键入路径最短（NFR-10）；升级 CodeMirror
 * 时仅替换本类，上层不动。Tab 插入两个空格，保持所见即源码。
 */
export class TextareaSourceAdapter implements EditorAdapter {
  private readonly textarea: HTMLTextAreaElement;
  private disposed = false;

  constructor(host: HTMLElement, options: { initialMarkdown: string; onInput: (markdown: string) => void }) {
    this.textarea = document.createElement("textarea");
    this.textarea.className = "mn-editor-source";
    this.textarea.value = options.initialMarkdown;
    this.textarea.spellcheck = false;
    this.textarea.setAttribute("aria-label", "Markdown 源码编辑");
    this.textarea.addEventListener("input", () => options.onInput(this.textarea.value));
    this.textarea.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        event.preventDefault();
        const { selectionStart, selectionEnd } = this.textarea;
        this.textarea.setRangeText("  ", selectionStart, selectionEnd, "end");
        options.onInput(this.textarea.value);
      }
    });
    host.appendChild(this.textarea);
  }

  loadMarkdown(markdown: string): void {
    if (this.disposed) return;
    if (this.textarea.value !== markdown) this.textarea.value = markdown;
  }

  getMarkdown(): string {
    return this.textarea.value;
  }

  focus(): void {
    this.textarea.focus();
  }

  destroy(): void {
    this.disposed = true;
    this.textarea.remove();
  }
}
