import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Eye, Lock, Pencil, ShieldOff, Focus } from "../../icons";
import type { Item } from "@menote/shared";
import { NoteEditor } from "../editor";
import { MarkdownView } from "../markdown";
import { TableDocument } from "../table";
import { useItem, useLockVersion } from "../../services/contentHooks";
import { degradeTableToNote } from "../../services/contentService";
import { decryptToPlain, parseEnvelope, saveEncryptedContent } from "../../services/encryptionCommandService";
import { isNoteUnlocked, lockItem, lockOnLeave, openSpaceNote, readPlain, registerBeforeLock, unlockNote } from "../../services/keyringService";
import { lockPrivateSpace, unlockPrivateSpace } from "../../services/privateSpaceService";
import { UnlockPanel } from "../encryption";
import { DocTitle } from "./DocTitle";
import { discardRecovery, openRecoveryMarkdown, readRecovery, scheduleRecovery, shouldOfferRecovery, writeRecovery } from "../../services/recoveryService";
import { DocSyncStatus } from "../sync";
import { notifyEditorChange, registerEditorSave } from "../../services/editorSaveService";
import { ConflictCompare } from "./ConflictCompare";

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
  // 脏计数：编辑器的 onInput 只是「正文变了」的信号，不带正文（FR-EDT-10）。
  const [dirtyTick, setDirtyTick] = useState(0);
  const [savedTick, setSavedTick] = useState(0);
  const dirtyTickRef = useRef(dirtyTick);
  dirtyTickRef.current = dirtyTick;
  // 预览用的正文：切到预览时从编辑器取一次全量（编辑器在预览态会卸载）。
  const [previewText, setPreviewText] = useState<string | null>(null);
  // 编辑器注册的全量取值器（落盘出口）：保存、预览、解除加密都从它取正文。
  const getMarkdownRef = useRef<(() => string) | null>(null);
  // plain 的最新值：自动保存的定时器里读它，避免定时器闭包拿到旧明文。
  const plainRef = useRef<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [recoveryText, setRecoveryText] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [focusMode, setFocusMode] = useState(false);
  const unlocked = isNoteUnlocked(item.id);
  const conflictSource = useItem(userId, item.conflictOf ?? null);
  const inSpace = item.content.scope === "private_space";

  useEffect(() => {
    if (!focusMode) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setFocusMode(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusMode]);

  useEffect(() => {
    if (!inSpace || unlocked) return;
    let cancelled = false;
    void openSpaceNote(item.id, item.topicId).then((result) => {
      if (cancelled) return;
      if (result === "no_wrap") setUnlockError("这则笔记缺少空间密钥包装，暂时打不开。");
    });
    return () => { cancelled = true; };
  }, [inSpace, item.id, item.topicId, unlocked]);

  useEffect(() => {
    if (!unlocked) { setPlain(null); setReadError(null); return; }
    if (item.content.scope !== "plain" && plain === null && readError === null) {
      void readPlain(item.id, parseEnvelope(item.content.ciphertext)).then((value) => {
        if (value === null) {
          setReadError("正文解密失败，已停止自动保存，避免用空内容覆盖原文。");
          return;
        }
        setPlain(value);
      });
    }
  }, [unlocked, item, plain, readError]);

  // 同步 plain 的最新值（给自动保存的定时器用）。
  useEffect(() => { plainRef.current = plain; }, [plain]);

  // 单篇离开即重锁（FR-ENC-4）；父组件按 noteId key 重挂载。
  useEffect(() => () => lockOnLeave(item.id), [item.id]);

  const flush = useCallback(async (value: string | null) => {
    if (value === null || !isNoteUnlocked(item.id)) return false;
    const savingTick = dirtyTickRef.current;
    setSaveState({ kind: "saving" });
    try {
      await saveEncryptedContent(userId, item.id, value);
      setPlain(value);
      setSavedTick(savingTick);
      setSaveState({ kind: "idle" });
      return true;
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
      return false;
    }
  }, [item.id, userId]);

  useEffect(() => registerEditorSave(userId, async () => {
    if (dirtyTick <= savedTick && saveState.kind !== "error") return true;
    return flush(getMarkdownRef.current?.() ?? plainRef.current);
  }), [userId, dirtyTick, savedTick, saveState.kind, flush]);

  useEffect(() => { notifyEditorChange(); }, [dirtyTick]);

  useEffect(() => {
    if (!unlocked || plain === null) return;
    let cancelled = false;
    void readRecovery(item.id).then(async (row) => {
      if (cancelled || !row || row.scope !== "sealed") return;
      const text = await openRecoveryMarkdown(row);
      if (!cancelled) setRecoveryText(shouldOfferRecovery(plain, text) ? text : null);
    });
    return () => { cancelled = true; };
  }, [item.id, unlocked, plain]);

  useEffect(() => {
    if (!unlocked || plain === null || dirtyTick === 0) return;
    const next = getMarkdownRef.current?.() ?? plain;
    if (next !== null) scheduleRecovery(userId, item.id, next, "sealed");
  }, [dirtyTick, unlocked, plain, item.id, userId]);

  useEffect(() => {
    const flushSnapshot = () => {
      if (!isNoteUnlocked(item.id) || plainRef.current === null) return;
      const next = getMarkdownRef.current?.() ?? plainRef.current;
      void writeRecovery(userId, item.id, next, "sealed");
    };
    window.addEventListener("pagehide", flushSnapshot);
    return () => window.removeEventListener("pagehide", flushSnapshot);
  }, [item.id, userId]);

  useEffect(() => registerBeforeLock(async () => {
    if (!isNoteUnlocked(item.id) || plainRef.current === null) return;
    await flush(getMarkdownRef.current?.() ?? plainRef.current);
  }), [item.id, flush]);

  // 自动保存：键入只给脏信号，800ms 后从编辑器取全量明文再存（FR-EDT-10）。
  // 编辑器未挂载（表格形态 / 预览态）时退回 plain 的最新值。
  useEffect(() => {
    if (plainRef.current === null || !unlocked || dirtyTick <= savedTick) return;
    const timer = setTimeout(() => {
      const next = getMarkdownRef.current?.() ?? plainRef.current;
    if (next === null) return;
    void flush(next);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [dirtyTick, savedTick, unlocked, flush]);

  const onUnlock = async (credential: string, useRecovery: boolean) => {
    setUnlockError(null);
    if (inSpace) {
      const result = await unlockPrivateSpace(userId, credential, useRecovery);
      if (result === "ok") {
        const opened = await openSpaceNote(item.id, item.topicId);
        if (opened !== "ok") setUnlockError("私人空间已解锁，但这则笔记打不开。");
      } else if (result === "bad_credential") setUnlockError("空间密码或恢复码不正确。");
      else setUnlockError("私人空间的密钥包装还没同步到本机，请稍后重试。");
      return;
    }
    const result = await unlockNote(item.id, credential, useRecovery);
    if (result === "bad_credential") setUnlockError("凭据不正确，或与当前作用域不符。");
    if (result === "no_wraps") setUnlockError("包装块尚未同步到本机，请稍后重试。");
  };

  const plainFlow = plain !== null && unlocked;

  return (
    <article className="mn-doc" aria-label="文档区" data-focus={focusMode || undefined}>
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
          <button type="button" className="mn-iconbtn" aria-label={focusMode ? "退出专注模式" : "专注模式"} title={focusMode ? "退出专注模式（Esc）" : "专注模式"} aria-pressed={focusMode} onClick={() => setFocusMode((value) => !value)}><Focus /></button>
          <DocSyncStatus userId={userId} itemId={item.id} saving={saveState.kind === "saving"} dirty={dirtyTick > savedTick} saveError={saveState.kind === "error"} onRetrySave={() => { const next = getMarkdownRef.current?.() ?? plain; if (next !== null) void flush(next); }} />
          {unlocked && (
            <>
              <button type="button" className="mn-iconbtn" aria-label="立即锁定" title="锁定（快捷）" onClick={() => { if (inSpace) void lockPrivateSpace(userId); else lockItem(item.id); }}>
                <Lock />
              </button>
              {!inSpace && (
                <button type="button" className="mn-iconbtn" aria-label="解除本篇加密" title="解除加密（转为明文）" disabled={plain === null}
                  onClick={() => {
                    const markdown = getMarkdownRef.current?.() ?? plain;
                    if (markdown === null) return;
                    if (!window.confirm("解除本篇加密并转为明文？")) return;
                    void decryptToPlain(userId, item.id, markdown).then(onBack);
                  }}>
                  <ShieldOff />
                </button>
              )}
              <span className="mn-vt" role="group" aria-label="编辑/预览切换">
                <button type="button" className={mode === "edit" ? "on" : ""} aria-label="编辑" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}><Pencil /></button>
                <button type="button" className={mode === "preview" ? "on" : ""} aria-label="预览" aria-pressed={mode === "preview"}
                  onClick={() => {
                    // 切到预览前取一次全量正文：预览态编辑器会卸载，之后就取不到了（FR-EDT-10）。
                    const text = getMarkdownRef.current?.() ?? plain;
                    if (text === null) return;
                    setPlain(text);
                    setPreviewText(text);
                    setMode("preview");
                  }}><Eye /></button>
              </span>
            </>
          )}
        </span>
      </div>
      <div className="mn-docbody">
        <DocTitle value={item.title ?? ""} readOnly />
        {item.conflictOf && (
          <ConflictCompare userId={userId} copy={item} original={conflictSource} copyText={plain} onKeptOriginal={onBack} />
        )}
        {readError && <p className="mn-conflictnote">{readError}</p>}
        {recoveryText && (
          <p className="mn-conflictnote">
            <span>发现未保存的恢复副本。它只存在本机，并且是加密的。</span>
            <button type="button" className="mn-textbtn" onClick={() => { void flush(recoveryText); setRecoveryText(null); }}>恢复</button>
            <button type="button" className="mn-textbtn" onClick={() => { void discardRecovery(item.id); setRecoveryText(null); }}>丢弃</button>
          </p>
        )}
        {!unlocked && (
          <UnlockPanel
            onUnlock={onUnlock}
            error={unlockError}
            title={inSpace ? "私人空间已锁定" : undefined}
            passwordHint={inSpace ? "输入空间密码解锁。解锁后，这次会话里的空间笔记都可以打开。" : undefined}
            passwordPlaceholder={inSpace ? "空间密码" : undefined}
          />
        )}
        {plainFlow && mode === "preview" && item.type !== "table" && <MarkdownView markdown={previewText ?? plain ?? ""} className="md-body markdown-content mn-doc-preview" />}
        {plainFlow && item.type === "table" && (
          <TableDocument
            userId={userId}
            itemId={item.id}
            markdown={plain}
            onChangeMarkdown={(next) => { setPlain(next); setDirtyTick((n) => n + 1); }}
            onDegrade={() => { void degradeTableToNote(userId, item.id); }}
            /* 加密条目不可能是空白草稿，脚手架的切换入口不可达（守卫同 setItemForm）。 */
            onSwitchToNote={() => {}}
            readOnly={mode === "preview"}
            allowAttachments={false}
          />
        )}
        {plainFlow && mode === "edit" && item.type !== "table" && (
          <NoteEditor
            mode="edit"
            kind="wysiwyg"
            externalMarkdown={plain}
            onInput={() => setDirtyTick((n) => n + 1)}
            uploadFile={async () => ({ error: "加密笔记的附件不能明文上传。附件密文方案尚未定稿，请先解除加密再添加附件。" })}
            registerGetMarkdown={(get) => { getMarkdownRef.current = get; }}
            registerApplyExternal={() => {}}
          />
        )}
      </div>
    </article>
  );
}
