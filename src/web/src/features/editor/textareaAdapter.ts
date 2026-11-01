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

  getSelection(): { start: number; end: number } {
    return { start: this.textarea.selectionStart, end: this.textarea.selectionEnd };
  }

  setSelection(start: number, end: number): void {
    if (this.disposed) return;
    this.textarea.setSelectionRange(start, end);
  }

  caretRect(): { top: number; left: number; bottom: number } | null {
    const box = this.textarea.getBoundingClientRect();
    const style = getComputedStyle(this.textarea);
    const mirror = document.createElement("div");
    mirror.style.position = "fixed";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.overflowWrap = "break-word";
    mirror.style.width = style.width;
    mirror.style.font = style.font;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.padding = style.padding;
    mirror.textContent = this.textarea.value.slice(0, this.textarea.selectionStart);
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const markerBox = marker.getBoundingClientRect();
    const mirrorBox = mirror.getBoundingClientRect();
    mirror.remove();
    const top = box.top + (markerBox.top - mirrorBox.top) - this.textarea.scrollTop;
    const left = box.left + (markerBox.left - mirrorBox.left);
    return { top, left, bottom: top + markerBox.height };
  }

  focus(): void {
    this.textarea.focus();
  }

  destroy(): void {
    this.disposed = true;
    this.textarea.remove();
  }
}
