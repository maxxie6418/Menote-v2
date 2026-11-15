import { useEffect, useRef, useState } from "react";
import { X } from "../../icons";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  initial?: string;
  placeholder?: string;
}

export interface AlertOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
}

type DialogRequest = {
  id: number;
  kind: "confirm" | "prompt" | "alert";
  options: ConfirmOptions | PromptOptions | AlertOptions;
  resolve: (value: boolean | string | null | void) => void;
};

type Listener = (pending: DialogRequest) => void;

/** 宿主未挂载时按“取消”结算，调用方行为与用户拒绝一致（fail-safe）。 */
let listener: Listener | null = null;
let seq = 0;

function request(kind: "confirm", options: ConfirmOptions): Promise<boolean>;
function request(kind: "prompt", options: PromptOptions): Promise<string | null>;
function request(kind: "alert", options: AlertOptions): Promise<void>;
function request(kind: DialogRequest["kind"], options: ConfirmOptions | PromptOptions | AlertOptions): Promise<boolean | string | null | void> {
  return new Promise((resolve) => {
    if (listener) listener({ id: ++seq, kind, options, resolve });
    else resolve(kind === "confirm" ? false : kind === "prompt" ? null : undefined);
  });
}

/** 应用内确认窗（替代 window.confirm）：true=确认，false=取消/Esc。 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return request("confirm", options);
}

/** 应用内输入窗（替代 window.prompt）：resolve 输入原文或 null（取消/Esc）。 */
export function promptDialog(options: PromptOptions): Promise<string | null> {
  return request("prompt", options);
}

/** 应用内提示窗（替代 window.alert）。 */
export function alertDialog(options: AlertOptions): Promise<void> {
  return request("alert", options);
}

/** 全局弹窗宿主：App 根部挂载一次，串行处理所有请求；结构与既有 mn-dialog 一致。 */
export function ConfirmDialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const currentRef = useRef<DialogRequest | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listener = (pending) => {
      queueRef.current.push(pending);
      if (!currentRef.current) pump();
    };
    return () => { listener = null; };
  }, []);

  const pump = () => {
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  };

  const finish = (settle: (pending: DialogRequest) => void) => {
    const active = currentRef.current;
    if (!active) return;
    currentRef.current = null;
    setCurrent(null);
    settle(active);
    if (queueRef.current.length > 0) pump();
  };

  const cancel = () => finish((pending) => {
    if (pending.kind === "prompt") pending.resolve(null);
    else if (pending.kind === "confirm") pending.resolve(false);
    else pending.resolve();
  });
  const accept = () => finish((pending) => {
    if (pending.kind === "prompt") pending.resolve(draftRef.current?.value ?? "");
    else if (pending.kind === "confirm") pending.resolve(true);
    else pending.resolve();
  });

  // cancel 以 ref 供陷阱 effect 使用：与 TagManagerDialog 同因——内联箭头随重渲染换新，
  // 作为依赖会让陷阱 effect 反复重跑，把焦点拽离弹窗。
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  const dialogRef = useRef<HTMLElement>(null);
  const dialogId = current?.id;
  useEffect(() => {
    if (dialogId === undefined) return;
    const active = currentRef.current;
    const danger = active?.kind === "confirm" && (active.options as ConfirmOptions).danger === true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTarget = () => {
      if (!dialogRef.current) return null;
      if (active?.kind === "prompt") return dialogRef.current.querySelector<HTMLElement>("input");
      // 破坏性确认默认焦点落在取消上，避免回车误触。
      if (danger) {
        return dialogRef.current.querySelector<HTMLElement>(".mn-dialog-actions .mn-auth-link");
      }
      return dialogRef.current.querySelector<HTMLElement>(".mn-dialog-actions button");
    };
    focusTarget()?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); cancelRef.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? [])];
      if (!nodes.length) { event.preventDefault(); return; }
      const first = nodes[0]!; const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [dialogId]);

  if (!current) return null;
  const { options } = current;
  const isPrompt = current.kind === "prompt";
  const isAlert = current.kind === "alert";
  const danger = current.kind === "confirm" && (options as ConfirmOptions).danger === true;
  const confirmLabel = options.confirmLabel ?? (isAlert ? "知道了" : "确定");
  return (
    <div className="mn-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) cancel(); }}>
      <section key={current.id} ref={dialogRef} className="mn-dialog" role="dialog" aria-modal="true"
        aria-label={isPrompt ? "输入" : isAlert ? "提示" : "确认"} aria-labelledby="mn-confirm-title" tabIndex={-1}
        onKeyDown={(event) => { if (event.key === "Enter" && !isPrompt) { event.preventDefault(); accept(); } }}>
        <header className="mn-dialog-head">
          <h2 className="mn-dialog-title" id="mn-confirm-title">{options.title}</h2>
          <button type="button" className="mn-iconbtn" aria-label="关闭" onClick={cancel}><X /></button>
        </header>
        <div className="mn-dialog-body">
          {options.message && <p className="mn-sethint">{options.message}</p>}
          {isPrompt && (
            <form onSubmit={(event) => { event.preventDefault(); accept(); }}>
              <input ref={draftRef} className="mn-propinput" defaultValue={(current.options as PromptOptions).initial ?? ""}
                placeholder={(current.options as PromptOptions).placeholder} autoFocus aria-label={options.title} />
            </form>
          )}
        </div>
        <footer className="mn-dialog-actions">
          <button type="button" className={danger ? "mn-auth-submit is-danger" : "mn-auth-submit"} onClick={accept}>{confirmLabel}</button>
          {!isAlert && <button type="button" className="mn-auth-link" onClick={cancel}>{(options as ConfirmOptions).cancelLabel ?? "取消"}</button>}
        </footer>
      </section>
    </div>
  );
}
