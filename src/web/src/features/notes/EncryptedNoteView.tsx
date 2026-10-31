import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, Eye, Lock, Pencil, ShieldOff } from "lucide-react";
import type { Item } from "@menote/shared";
import { NoteEditor } from "../editor";
import { MarkdownView } from "../markdown";
import { useItem, useLockVersion } from "../../services/contentHooks";
import { decryptToPlain, parseEnvelope, saveEncryptedContent } from "../../services/encryptionCommandService";
import { isNoteUnlocked, lockItem, lockOnLeave, readPlain, unlockNote } from "../../services/keyringService";
import { UnlockPanel } from "../encryption";

const AUTOSAVE_DEBOUNCE_MS = 800;

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "error"; message: string };

interface EncryptedNoteViewProps {
  userId: string;
  item: Item;
  crumb: string;
  showBack: boolean;
  onBack: () => void;
}

/** 加密条目视图（FR-ENC-3/4/5）：标题明文可编辑；锁定态只此面板；解锁态内存明文编辑；
 *  属性区不用于加密条目（YAML 明文 frontmatter 会破坏密文边界，G7 设计决定）。 */
export function EncryptedNoteView({ userId, item, crumb, showBack, onBack }: EncryptedNoteViewProps) {
  useLockVersion();
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [plain, setPlain] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const unlocked = isNoteUnlocked(item.id);

  useEffect(() => {
    if (!unlocked) { setPlain(null); return; }
    if (item.content.scope !== "plain" && plain === null) {
      void readPlain(item.id, parseEnvelope(item.content.ciphertext)).then((value) => setPlain(value ?? ""));
    }
  }, [unlocked, item, plain]);

  // 单篇离开即重锁（FR-ENC-4）；父组件按 noteId key 重挂载。
  useEffect(() => () => lockOnLeave(item.id), [item.id]);

  const flush = useCallback(async (value: string | null) => {
    if (value === null || !isNoteUnlocked(item.id)) return;
    setSaveState({ kind: "saving" });
    try {
      await saveEncryptedContent(userId, item.id, value);
      setSaveState({ kind: "idle" });
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
    }
  }, [item.id, userId]);

  useEffect(() => {
    if (plain === null || !unlocked) return;
    const timer = setTimeout(() => { void flush(plain); }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [plain, unlocked, flush]);

  const onUnlock = async (credential: string, useRecovery: boolean) => {
    setUnlockError(null);
    const result = await unlockNote(item.id, credential, useRecovery);
    if (result === "bad_credential") setUnlockError("凭据不正确，或与当前作用域不符。");
    if (result === "no_wraps") setUnlockError("包装块尚未同步到本机，请稍后重试。");
  };

  const plainFlow = plain !== null && unlocked;

  return (
    <article className="mn-doc" aria-label="文档区">
      <div className="mn-docbar">
        <span className="mn-docbar-left">
          {showBack && (
            <button type="button" className="mn-iconbtn" aria-label="返回清单" onClick={onBack}>
              <ChevronLeft />
            </button>
          )}
          <span className="mn-crumb">{crumb}</span>
        </span>
        <span className="mn-docbar-right">
          {saveState.kind === "saving" && <span className="mn-savestate">保存中…</span>}
          {saveState.kind === "error" && <button type="button" className="mn-savestate err" onClick={() => void flush(plain)}>保存失败 · 重试</button>}
          {unlocked && (
            <>
              <button type="button" className="mn-iconbtn" aria-label="立即锁定" title="锁定（快捷）" onClick={() => lockItem(item.id)}>
                <Lock />
              </button>
              <button type="button" className="mn-iconbtn" aria-label="解除本篇加密" title="解除加密（转为明文）"
                onClick={() => { if (window.confirm("解除本篇加密并转为明文？")) void decryptToPlain(userId, item.id, plain ?? "").then(onBack); }}>
                <ShieldOff />
              </button>
              <span className="mn-vt" role="group" aria-label="编辑/预览切换">
                <button type="button" className={mode === "edit" ? "on" : ""} aria-label="编辑" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}><Pencil /></button>
                <button type="button" className={mode === "preview" ? "on" : ""} aria-label="预览" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}><Eye /></button>
              </span>
            </>
          )}
        </span>
      </div>
      <div className="mn-docbody">
        <input className="mn-doc-title" value={item.title ?? ""} aria-label="标题" readOnly />
        {!unlocked && <UnlockPanel onUnlock={onUnlock} error={unlockError} />}
        {plainFlow && mode === "preview" && <MarkdownView markdown={plain} className="md-body mn-doc-preview" />}
        {plainFlow && mode === "edit" && (
          <NoteEditor
            mode="edit"
            externalMarkdown={plain}
            onInput={(value) => setPlain(value)}
            registerGetMarkdown={(get) => { void get; }}
            registerApplyExternal={() => {}}
          />
        )}
      </div>
    </article>
  );
}
