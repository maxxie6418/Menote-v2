import { createContext, useContext, useRef, useState, useSyncExternalStore } from "react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { createMemo } from "../../services/contentService";
import { uploadAttachment } from "../../services/attachmentService";
import { insertAttachment } from "../editor";

type CaptureSource = "home" | "sidebar" | "timeline" | "mobile";
type Notice = "saved" | "previous-saved" | "save-error" | "attachment-error";
interface Draft {
  body: string;
  tags: string;
  pending: "save" | "upload" | null;
  notice: Notice | null;
}

const notices = {
  saved: { text: "已保存", role: "status" },
  "previous-saved": { text: "上一条已保存", role: "status" },
  "save-error": { text: "保存失败，请重试。", role: "alert" },
  "attachment-error": { text: "附件上传失败，请重新选择或粘贴。", role: "alert" },
} as const;

export function parseCaptureTags(tags: string): string[] {
  return [...new Set(tags.split(/[，,\s]+/).map((tag) => tag.replace(/^#/, "")).filter(Boolean))];
}

function makeCapture(userId: string) {
  const listeners = new Set<() => void>();
  let draft: Draft = { body: "", tags: "", pending: null, notice: null };
  let revision = 0;
  const update = (patch: Partial<Draft>) => {
    draft = { ...draft, ...patch };
    listeners.forEach((notify) => notify());
  };
  const edit = (patch: Partial<Pick<Draft, "body" | "tags">>) => {
    if ((patch.body ?? draft.body) === draft.body && (patch.tags ?? draft.tags) === draft.tags) return;
    revision++;
    const saved = draft.notice === "saved" || draft.notice === "previous-saved";
    update({ ...patch, notice: saved ? null : draft.notice });
  };

  return {
    read: () => draft,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
    setBody: (body: string | ((current: string) => string)) => edit({ body: typeof body === "string" ? body : body(draft.body) }),
    setTags: (tags: string) => edit({ tags }),
    clear: () => { revision++; update({ body: "", tags: "", notice: null }); },
    async save() {
      const body = draft.body.trim();
      if (!body || draft.pending) return false;
      const snapshot = revision;
      const tags = parseCaptureTags(draft.tags);
      update({ pending: "save", notice: null });
      try {
        await createMemo(userId, body, tags);
        if (revision === snapshot) {
          update({ body: "", tags: "", pending: null, notice: "saved" });
          return true;
        }
        update({ pending: null, notice: "previous-saved" });
      } catch {
        update({ pending: null, notice: "save-error" });
      }
      return false;
    },
    async attach(files: File[], currentCaret: () => number | undefined) {
      if (!files.length || draft.pending) return null;
      const originalBody = draft.body;
      const originalCaret = currentCaret();
      update({ pending: "upload", notice: null });
      let failed = false;
      const uploaded: Array<{ name: string; sha256: string; image: boolean }> = [];
      for (const file of files) {
        try {
          const result = await uploadAttachment(userId, file);
          if ("error" in result) failed = true;
          else uploaded.push({ ...result, image: file.type.startsWith("image/") });
        } catch {
          failed = true;
        }
      }
      let markdown = draft.body;
      const activeCaret = currentCaret();
      let caret = Math.min(markdown.length, activeCaret ?? (markdown === originalBody ? originalCaret : undefined) ?? markdown.length);
      for (const attachment of uploaded) {
        const placed = insertAttachment(markdown, caret, attachment, attachment.image);
        markdown = placed.markdown;
        caret = placed.selectionStart;
      }
      if (uploaded.length) revision++;
      update({ body: markdown, pending: null, notice: failed ? "attachment-error" : null });
      return uploaded.length ? { markdown, caret } : null;
    },
  };
}

const CaptureContext = createContext<Record<CaptureSource, ReturnType<typeof makeCapture>> | null>(null);

/** Unsaved inputs live with this authenticated shell across route and layout changes. */
export function MemoCaptureProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [captures] = useState(() => ({
    home: makeCapture(userId),
    sidebar: makeCapture(userId),
    timeline: makeCapture(userId),
    mobile: makeCapture(userId),
  }));
  return <CaptureContext.Provider value={captures}>{children}</CaptureContext.Provider>;
}

export function useMemoCapture(source: CaptureSource) {
  const captures = useContext(CaptureContext);
  if (!captures) throw new Error("MemoCaptureProvider is required");
  const capture = captures[source];
  const draft = useSyncExternalStore(capture.subscribe, capture.read, capture.read);
  const composing = useRef(false);

  function onShortcut(event: KeyboardEvent<HTMLElement>, submit: () => void, escape?: () => void) {
    if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!event.repeat) submit();
    } else if (event.key === "Escape" && escape) {
      event.preventDefault();
      escape();
    }
  }

  async function attachFiles(files: File[], input: () => HTMLTextAreaElement | null) {
    const node = input();
    if (!files.length || capture.read().pending) return;
    node?.focus({ preventScroll: true });
    const result = await capture.attach(files, () => {
      const current = input();
      return current && document.activeElement === current ? current.selectionStart : undefined;
    });
    if (result) requestAnimationFrame(() => {
      const current = input();
      if (current && document.activeElement === current && current.value === result.markdown) {
        current.setSelectionRange(result.caret, result.caret);
      }
    });
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>, input: () => HTMLTextAreaElement | null) {
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length || capture.read().pending) return;
    event.preventDefault();
    void attachFiles(files, input);
  }

  return {
    ...draft,
    feedback: draft.notice ? notices[draft.notice] : null,
    setBody: capture.setBody,
    setTags: capture.setTags,
    clear: capture.clear,
    save: () => composing.current ? Promise.resolve(false) : capture.save(),
    attachFiles,
    onPaste,
    onShortcut,
    compositionProps: {
      onCompositionStart: () => { composing.current = true; },
      onCompositionEnd: () => { composing.current = false; },
    },
  };
}
