import { useEffect, useRef, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { X } from "../../icons";

export type NoteInspectorTab = "annotations" | "scripts";

interface NoteInspectorProps {
  open: boolean;
  onClose: () => void;
  tab: NoteInspectorTab;
  onTabChange: (tab: NoteInspectorTab) => void;
  properties?: ReactNode;
  outline: ReactNode;
  annotations: ReactNode;
  versions: ReactNode;
}

export function NoteInspector({ open, onClose, tab, onTabChange, properties, outline, annotations, versions }: NoteInspectorProps) {
  const inspectorRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const inspector = inspectorRef.current;
    const close = closeRef.current;
    if (!open || !inspector || !close?.getClientRects().length) return;
    const previous = document.activeElement;
    if (!inspector.contains(previous)) close.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      const focused = document.activeElement;
      if (event.defaultPrevented || !close.getClientRects().length || focused?.closest('[role="dialog"]')) return;
      if (event.key === "Escape") {
        if (focused?.closest('[data-panel-trigger][aria-expanded="true"]')) return;
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(inspector.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]'))
        .filter((control) => control.tabIndex >= 0 && !control.matches(":disabled") && control.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && focused === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && focused === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const focused = document.activeElement;
      if ((focused === document.body || inspector.contains(focused)) && previous instanceof HTMLElement && !inspector.contains(previous) && previous.isConnected) {
        previous.focus();
      }
    };
  }, [open, onClose]);

  return (
    <>
      <button type="button" tabIndex={-1} className="mn-doc-inspector-backdrop" aria-label="关闭文档侧栏" onClick={onClose} />
      <aside ref={inspectorRef} id="mn-doc-inspector" className="mn-doc-inspector" aria-label="文档侧栏">
        <header className="mn-inspector-mobile-head">
          <strong>文档侧栏</strong>
          <button ref={closeRef} type="button" className="mn-iconbtn" aria-label="关闭侧栏" onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <div className="mn-inspector-scroll">
          {properties}
          {outline}
          <Tabs.Root className="mn-inspector-section" value={tab} onValueChange={onTabChange}>
            <Tabs.List className="mn-inspector-tablist" aria-label="批注与脚本">
              <Tabs.Tab className="mn-inspector-tab" value="annotations">批注</Tabs.Tab>
              <Tabs.Tab className="mn-inspector-tab" value="scripts">脚本</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel className="mn-inspector-panel" value="annotations">{annotations}</Tabs.Panel>
            <Tabs.Panel className="mn-inspector-panel" value="scripts"><p className="mn-outline-empty">暂无可显示的脚本</p></Tabs.Panel>
          </Tabs.Root>
          {versions}
        </div>
      </aside>
    </>
  );
}
