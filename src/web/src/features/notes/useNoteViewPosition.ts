import { useCallback, useLayoutEffect, useRef } from "react";
import type { EditorCursor } from "../editor";
import { notePositionKey, readNotePosition, sourceBlockOffsets, writeNotePosition, type NoteViewPosition } from "../../lib/noteViewPosition";

type NoteView = "preview" | "source" | "wysiwyg";

const unit = (value: number) => Math.max(0, Math.min(1, value));
const topOf = (element: HTMLElement) => element.getBoundingClientRect().top + element.clientTop;

/** 保存期间仍可继续键入。只有编辑器仍是本次已保存的版本时才切换。 */
export async function saveBeforeNoteViewChange<T>(read: () => T, save: (value: T) => Promise<boolean>): Promise<boolean> {
  const value = read();
  return await save(value) && read() === value;
}

/** textarea 会自动折行，用同宽镜像测量源码块，而非按行号估算。 */
function sourceMarkerTops(source: HTMLTextAreaElement, offsets: number[]): number[] {
  const mirror = document.createElement("div");
  const computed = getComputedStyle(source);
  Object.assign(mirror.style, {
    position: "fixed", top: "0", left: "0", visibility: "hidden", pointerEvents: "none",
    boxSizing: "border-box", width: `${source.clientWidth}px`,
    fontFamily: computed.fontFamily, fontSize: computed.fontSize, fontWeight: computed.fontWeight,
    fontStyle: computed.fontStyle, lineHeight: computed.lineHeight, letterSpacing: computed.letterSpacing,
    textIndent: computed.textIndent, tabSize: computed.tabSize, padding: computed.padding,
    whiteSpace: source.wrap === "off" ? "pre" : "pre-wrap", overflowWrap: "break-word",
  });
  const markdown = source.value;
  let from = 0;
  const markers = offsets.map((offset) => {
    const marker = document.createElement("span");
    marker.textContent = "\u200b";
    mirror.append(document.createTextNode(markdown.slice(from, offset)), marker);
    from = offset;
    return marker;
  });
  mirror.append(document.createTextNode(markdown.slice(from)));
  document.body.append(mirror);
  const start = mirror.getBoundingClientRect().top;
  const tops = markers.map((marker) => marker.getBoundingClientRect().top - start);
  mirror.remove();
  return tops;
}

function renderedBlocks(scroller: HTMLElement, view: NoteView): HTMLElement[] | null {
  const root = scroller.querySelector(view === "preview" ? ".mn-doc-preview" : ".mn-editor-host:not([hidden]) .ProseMirror");
  if (!root) return null;
  if (root.querySelector(".md-lite-text")) return [];
  return Array.from(root.children).filter((element): element is HTMLElement =>
    element instanceof HTMLElement && element.tagName !== "STYLE" && element.tagName !== "SCRIPT");
}

/** 视口顶部命中的块；块内比例能适应编辑、预览与等宽源码不同的排版。 */
function captureRendered(scroller: HTMLElement, blocks: HTMLElement[]): NoteViewPosition {
  const top = topOf(scroller);
  for (let index = 0; index < blocks.length; index += 1) {
    const { top: blockTop, bottom, height } = blocks[index]!.getBoundingClientRect();
    if (bottom <= top) continue;
    if (index === 0 && blockTop > top) break;
    return { block: index, fraction: unit((top - blockTop) / Math.max(1, height)), scrollTop: scroller.scrollTop };
  }
  return { block: null, fraction: 0, scrollTop: scroller.scrollTop };
}

function captureSource(scroller: HTMLElement, source: HTMLTextAreaElement, hasFrontmatter: boolean): NoteViewPosition {
  const clippedTop = topOf(scroller) - topOf(source);
  if (clippedTop < 0 && source.scrollTop === 0) return { block: null, fraction: 0, scrollTop: scroller.scrollTop };
  const offsets = sourceBlockOffsets(source.value, hasFrontmatter);
  const tops = sourceMarkerTops(source, offsets);
  const top = Math.max(0, clippedTop) + source.scrollTop;
  let block = tops.length - 1;
  while (block >= 0 && tops[block]! > top) block -= 1;
  if (block < 0) return { block: null, fraction: 0, scrollTop: scroller.scrollTop };
  const height = (tops[block + 1] ?? source.scrollHeight) - tops[block]!;
  return { block, fraction: unit((top - tops[block]!) / Math.max(1, height)), scrollTop: scroller.scrollTop };
}

function restoreSource(scroller: HTMLElement, source: HTMLTextAreaElement, hasFrontmatter: boolean, position: NoteViewPosition): number | undefined {
  if (position.block === null) {
    source.scrollTop = 0;
    scroller.scrollTop = position.scrollTop;
    return undefined;
  }
  const offsets = sourceBlockOffsets(source.value, hasFrontmatter);
  const index = Math.min(position.block, offsets.length - 1);
  const start = offsets[index];
  if (start === undefined) {
    scroller.scrollTop = position.scrollTop;
    return undefined;
  }
  const next = offsets[index + 1];
  const [top = 0, bottom = source.scrollHeight] = sourceMarkerTops(source, next === undefined ? [start] : [start, next]);
  const target = top + (bottom - top) * position.fraction;
  source.scrollTop = target;
  scroller.scrollTop += topOf(source) + target - source.scrollTop - topOf(scroller);
  return start;
}

export function useNoteViewPosition(userId: string, itemId: string, view: NoteView, enabled: boolean, sealed = false) {
  const key = notePositionKey(userId, itemId, sealed);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorCursor | null>(null);
  const afterEditorReady = useRef<(() => void) | null>(null);
  const capture = useRef<(() => void) | null>(null);
  const registerCursor = useCallback((value: EditorCursor | null) => {
    editor.current = value;
    if (value) afterEditorReady.current?.();
  }, []);
  const rememberPosition = useCallback(() => capture.current?.(), []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!enabled || !scroller) return;
    const hasFrontmatter = view === "source" && !sealed;
    let prior = readNotePosition(key, sealed);
    let pending = prior;
    let frame = 0;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let previewPasses = 0;
    let stablePreviewFrames = 0;
    let switching = false;
    const content = () => {
      const cursor = view === "preview" ? null : editor.current;
      // Use the newly requested view. During a switch, React can commit the parent
      // layout effect before NoteEditor disposes the outgoing adapter.
      if (view !== "preview" && cursor?.requestedKind !== view) return null;
      const source = cursor?.kind === "source" ? scroller.querySelector<HTMLTextAreaElement>(".mn-editor-host:not([hidden]) textarea") : null;
      if (cursor?.kind === "source") return source ? { cursor, source, blocks: null } : null;
      const blocks = renderedBlocks(scroller, view);
      return blocks ? { cursor, source: null, blocks } : null;
    };
    const stopRestore = () => {
      pending = undefined;
      observer?.disconnect();
      clearTimeout(restoreTimer);
      cancelAnimationFrame(frame);
    };
    const readCurrent = () => {
      if (pending || switching) return;
      const ready = content();
      if (!ready) return;
      const { cursor, source, blocks } = ready;
      const position = source ? captureSource(scroller, source, hasFrontmatter) : captureRendered(scroller, blocks);
      if (cursor) position.cursor = { ...cursor.read(), kind: cursor.kind, block: position.block };
      else if (prior?.cursor) position.cursor = prior.cursor;
      writeNotePosition(key, sealed, position);
      prior = position;
    };
    const restore = (allowFallback = false) => {
      if (!pending) return;
      const position = pending;
      const ready = content();
      if (!ready) return;
      const { cursor, source, blocks } = ready;
      let sourceOffset: number | undefined;
      if (source) sourceOffset = restoreSource(scroller, source, hasFrontmatter, position);
      else if (position.block === null || blocks.length === 0) scroller.scrollTop = position.scrollTop;
      else {
        const block = blocks[position.block];
        if (!block && !allowFallback) return;
        const target = (block ?? blocks.at(-1)!).getBoundingClientRect();
        const next = scroller.scrollTop + target.top - topOf(scroller) + target.height * position.fraction;
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const destination = Math.min(max, Math.max(0, next));
        if (view === "preview" && block) {
          // 懒渲染块刚滚入视口时，会由占位高度切回真实高度。保持原块
          // 作为锚点直到位置稳定，期间滚动回调不覆盖它，用户输入可立即中止。
          const moved = Math.abs(scroller.scrollTop - destination) > 1;
          stablePreviewFrames = moved ? 0 : stablePreviewFrames + 1;
          if (moved) scroller.scrollTop = destination;
          if (stablePreviewFrames < 2 && previewPasses < 10) {
            previewPasses += 1;
            frame = requestAnimationFrame(() => restore(allowFallback));
            return;
          }
        } else scroller.scrollTop = destination;
      }
      if (cursor) {
        if (position.cursor?.kind === cursor.kind && position.cursor.block === position.block) {
          cursor.restore(position.cursor.start, position.cursor.end);
        } else if (sourceOffset !== undefined) cursor.restore(sourceOffset, sourceOffset);
        else if (!source && position.block !== null) cursor.restoreBlock(position.block);
      }
      stopRestore();
    };
    const scheduleRestore = () => {
      if (!pending) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => restore());
    };
    const scheduleCapture = () => {
      if (pending || switching) return;
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(readCurrent, 150);
    };
    const interruptRestore = () => { if (pending) stopRestore(); };
    capture.current = () => {
      readCurrent();
      // The old adapter can survive the DOM commit. Its viewport may already be
      // laid out for the incoming mode by the time the old effect cleans up.
      switching = true;
      clearTimeout(scrollTimer);
    };
    afterEditorReady.current = scheduleRestore;
    if (pending) {
      observer = new MutationObserver(scheduleRestore);
      observer.observe(scroller, { childList: true, subtree: true });
      restore();
      if (pending) restoreTimer = setTimeout(() => restore(true), 1500);
    } else {
      // .mn-docbody can survive a change of view and retain the old note's pixels.
      scroller.scrollTop = 0;
    }
    const interactions = ["wheel", "pointerdown", "touchstart", "keydown"] as const;
    for (const event of interactions) scroller.addEventListener(event, interruptRestore, { capture: true, passive: true });
    scroller.addEventListener("scroll", scheduleCapture, { capture: true, passive: true });
    scroller.addEventListener("focusout", readCurrent);
    window.addEventListener("pagehide", readCurrent);
    return () => {
      readCurrent();
      stopRestore();
      clearTimeout(scrollTimer);
      capture.current = null;
      afterEditorReady.current = null;
      for (const event of interactions) scroller.removeEventListener(event, interruptRestore, true);
      scroller.removeEventListener("scroll", scheduleCapture, true);
      scroller.removeEventListener("focusout", readCurrent);
      window.removeEventListener("pagehide", readCurrent);
    };
  }, [key, view, enabled, sealed]);

  return { scrollerRef, registerCursor, rememberPosition };
}
