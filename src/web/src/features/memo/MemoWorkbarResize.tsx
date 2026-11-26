import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { MEMO_WORKBAR_WIDTH, normalizeMemoWorkbarWidth, readWorkspaceSettings, updateWorkspaceSettings } from "../../services/workspaceSettingsService";

const WIDTH_CSS = "--mn-memo-workbar-width";
const STEP = 16;

interface Drag {
  pointerId: number;
  x: number;
  width: number;
  direction: number;
  scale: number;
}

function widthScale() {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1;
}

export function MemoWorkbarResize({ userId, paneRef }: { userId: string; paneRef: RefObject<HTMLElement | null> }) {
  const handleRef = useRef<HTMLDivElement>(null);
  const savedWidth = useRef(MEMO_WORKBAR_WIDTH.initial);
  const drag = useRef<Drag | null>(null);
  const [width, setWidth] = useState(MEMO_WORKBAR_WIDTH.initial);

  const showWidth = (next: number) => {
    handleRef.current?.parentElement?.style.setProperty(WIDTH_CSS, `${next / 16}rem`);
  };
  const renderedWidth = (scale: number) => {
    const physical = paneRef.current?.getBoundingClientRect().width;
    return physical ? normalizeMemoWorkbarWidth(physical / scale) : savedWidth.current;
  };
  const rightSide = () => document.documentElement.dataset.memoWorkbarSide === "right";

  useLayoutEffect(() => {
    let active = true;
    let request = 0;
    const refresh = () => {
      const id = ++request;
      void readWorkspaceSettings(userId).then((settings) => {
        if (!active || id !== request) return;
        savedWidth.current = settings.memoWorkbarWidth;
        if (!drag.current) showWidth(savedWidth.current);
      }).catch(() => {});
    };
    const observer = new ResizeObserver(() => setWidth(renderedWidth(widthScale())));
    if (paneRef.current) observer.observe(paneRef.current);
    refresh();
    window.addEventListener("menote:workspace-settings", refresh);
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("menote:workspace-settings", refresh);
    };
  }, [userId, paneRef]);

  const commit = (next: number, original: number) => {
    if (next === original) { showWidth(savedWidth.current); return; }
    showWidth(next);
    void updateWorkspaceSettings(userId, { memoWorkbarWidth: next }).catch(() => {
      if (!drag.current) showWidth(savedWidth.current);
    });
  };

  const offset = (start: Drag, clientX: number) =>
    normalizeMemoWorkbarWidth(start.width + start.direction * (clientX - start.x) / start.scale);

  const endDrag = (event: PointerEvent<HTMLDivElement>, apply: boolean) => {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    drag.current = null;
    delete event.currentTarget.dataset.resizeActive;
    if (!apply) { showWidth(savedWidth.current); return; }
    showWidth(offset(start, event.clientX));
    commit(renderedWidth(start.scale), start.width);
  };

  return (
    <div ref={handleRef} className="mn-memo-work-resize" role="separator" tabIndex={0}
      aria-orientation="vertical" aria-controls="mn-memo-workbar" aria-label="调整 Memo 侧记栏宽度"
      aria-valuemin={MEMO_WORKBAR_WIDTH.min} aria-valuemax={MEMO_WORKBAR_WIDTH.max} aria-valuenow={width}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const scale = widthScale();
        drag.current = { pointerId: event.pointerId, x: event.clientX, width: renderedWidth(scale), direction: rightSide() ? -1 : 1, scale };
        event.currentTarget.dataset.resizeActive = "";
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointerId === event.pointerId) showWidth(offset(drag.current, event.clientX));
      }}
      onPointerUp={(event) => endDrag(event, true)}
      onPointerCancel={(event) => endDrag(event, false)}
      onLostPointerCapture={(event) => endDrag(event, false)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
        event.preventDefault();
        if (drag.current) return;
        const scale = widthScale();
        const current = renderedWidth(scale);
        const direction = event.key === (rightSide() ? "ArrowLeft" : "ArrowRight") ? 1 : -1;
        const next = event.key === "Home" ? MEMO_WORKBAR_WIDTH.min
          : event.key === "End" ? MEMO_WORKBAR_WIDTH.max
            : normalizeMemoWorkbarWidth(current + direction * STEP);
        showWidth(next);
        commit(renderedWidth(scale), current);
      }}
    />
  );
}
