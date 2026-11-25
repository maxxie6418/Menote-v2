import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, Eye, Lock, Pencil, Shield, ShieldOff, Focus } from "../../icons";
import { confirmDialog } from "../../components/ui/ConfirmDialog";
import type { Item } from "@menote/shared";
import { NoteEditor } from "../editor";
import { MarkdownView } from "../markdown";
import { TableDocument } from "../table";
import { useItem, useLockVersion } from "../../services/contentHooks";
import { degradeTableToNote } from "../../services/contentService";
import { decryptToPlain, migrateEncryptedAttachments, parseEnvelope, saveEncryptedContent } from "../../services/encryptionCommandService";
import { isNoteUnlocked, lockItem, lockOnLeave, openSpaceNote, readPlain, registerBeforeLock, unlockNote } from "../../services/keyringService";
import { lockPrivateSpace, unlockPrivateSpace } from "../../services/privateSpaceService";
import { UnlockPanel } from "../encryption";
import { DocTitle } from "./DocTitle";
import { discardRecovery, openRecoveryMarkdown, readRecovery, scheduleRecovery, shouldOfferRecovery, writeRecovery } from "../../services/recoveryService";
import { DocSyncStatus } from "../sync";
import { notifyEditorChange, registerEditorSave } from "../../services/editorSaveService";
import { ConflictCompare } from "./ConflictCompare";
import { exportUnlockedAttachmentZip, hasPendingSealedAttachmentUpload, uploadSealedAttachment } from "../../services/sealedAttachmentService";
import { saveBeforeNoteViewChange, useNoteViewPosition } from "./useNoteViewPosition";

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
  // 编辑器注册的全量取值器（落盘出口）：保存、预览、解除加密都从它取正文。
  const getMarkdownRef = useRef<(() => string) | null>(null);
  // plain 的最新值：自动保存的定时器里读它，避免定时器闭包拿到旧明文。
  const plainRef = useRef<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [recoveryText, setRecoveryText] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [focusMode, setFocusMode] = useState(false);
  const [attachmentAction, setAttachmentAction] = useState<string | null>(null);
  const [migratingAttachments, setMigratingAttachments] = useState(false);
  const attachmentMigrationRef = useRef(false);
  const viewChanging = useRef(false);
  const unlocked = isNoteUnlocked(item.id);
  const conflictSource = useItem(userId, item.conflictOf ?? null);
  const inSpace = item.content.scope === "private_space";
  const plainFlow = plain !== null && unlocked;
  const notePosition = useNoteViewPosition(userId, item.id, mode === "preview" ? "preview" : "wysiwyg",
    plainFlow && item.type === "note", true);

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
    }).catch(() => {
      if (!cancelled) setUnlockError("无法保护这则笔记的本机恢复副本或历史，请稍后重试；原数据未改动。");
    });
    return () => { cancelled = true; };
  }, [inSpace, item.id, item.topicId, unlocked]);

  useEffect(() => {
    if (!unlocked) { plainRef.current = null; setPlain(null); setReadError(null); setRecoveryText(null); return; }
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
    if (value === null || !isNoteUnlocked(item.id) || attachmentMigrationRef.current) return false;
    const savingTick = dirtyTickRef.current;
    const previous = plainRef.current;
    setSaveState({ kind: "saving" });
    try {
      await saveEncryptedContent(userId, item.id, value);
      if (isNoteUnlocked(item.id) && plainRef.current === previous) {
        plainRef.current = value;
        setPlain(value);
      }
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
    if (!unlocked || plain === null || dirtyTick <= savedTick || attachmentMigrationRef.current) return;
    const next = getMarkdownRef.current?.() ?? plain;
    if (next !== null) scheduleRecovery(userId, item.id, next, "sealed");
  }, [dirtyTick, savedTick, unlocked, plain, item.id, userId]);

  useEffect(() => {
    const flushSnapshot = () => {
      if (!isNoteUnlocked(item.id) || plainRef.current === null || attachmentMigrationRef.current) return;
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
    try {
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
    } catch {
      setUnlockError("无法保护这则笔记的本机恢复副本或历史，请检查笔记密钥并重试；原数据未改动。");
    }
  };

  const switchMode = async (next: "edit" | "preview") => {
    if (next === mode || viewChanging.current || !plainFlow || attachmentMigrationRef.current) return;
    if (next === "edit") {
      notePosition.rememberPosition();
      setMode(next);
      return;
    }
    if (hasPendingSealedAttachmentUpload(item.id)) return;
    viewChanging.current = true;
    try {
      const saved = await saveBeforeNoteViewChange(() => getMarkdownRef.current?.() ?? plainRef.current,
        async (value) => value !== null && (value === plainRef.current && dirtyTickRef.current <= savedTick && saveState.kind !== "error"
          || await flush(value)));
      if (!saved || !isNoteUnlocked(item.id)) return;
      notePosition.rememberPosition();
      setMode(next);
    } catch (cause) {
      setSaveState({ kind: "error", message: String(cause) });
    } finally {
      viewChanging.current = false;
    }
  };

  const migrateAttachments = async () => {
    if (attachmentMigrationRef.current) return;
    if (hasPendingSealedAttachmentUpload(item.id)) {
      setAttachmentAction("请等待当前附件上传完成，再加密旧附件。");
      return;
    }
    if (dirtyTickRef.current > savedTick || saveState.kind !== "idle") {
      setAttachmentAction("请先保存当前修改，再加密旧附件。");
      return;
    }
    const confirmed = await confirmDialog({ title: "加密旧附件", confirmLabel: "加密旧附件",
      message: "浏览器会在本机加密旧附件、上传副本，并更新本篇正文、本机历史与恢复稿。原明文文件和旧备份仍会保留。其他设备的本机历史需在对应设备处理。仅被历史或恢复稿引用的附件仍受未引用附件保留期限影响。" });
    if (!confirmed || !isNoteUnlocked(item.id) || attachmentMigrationRef.current) return;
    if (hasPendingSealedAttachmentUpload(item.id)) {
      setAttachmentAction("请等待当前附件上传完成，再加密旧附件。");
      return;
    }
    if (dirtyTickRef.current > savedTick) {
      setAttachmentAction("请先保存当前修改，再加密旧附件。");
      return;
    }
    attachmentMigrationRef.current = true;
    setMigratingAttachments(true);
    setAttachmentAction(null);
    try {
      const result = await migrateEncryptedAttachments(userId, item);
      if (!isNoteUnlocked(item.id)) return;
      setPlain(result.markdown);
      setAttachmentAction(result.count ? `已加密 ${result.count} 个旧附件。本次操作保留原明文文件。` : "此笔记的正文、本机历史和恢复稿中没有需要转换的附件。");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      if (message === "attachment_migration_source_unavailable") setAttachmentAction("正文、本机历史或恢复稿中的附件无法读取。请确认文件仍可下载后重试。");
      else if (message === "attachment_migration_upload_failed") setAttachmentAction("附件密文副本上传失败。请检查网络和附件限额后重试。");
      else if (message === "attachment_migration_snapshot_unavailable") setAttachmentAction("本机历史或恢复稿无法解锁，旧附件转换已中止。");
      else setAttachmentAction("笔记已锁定或内容发生变化，请重新打开后重试。");
    } finally {
      attachmentMigrationRef.current = false;
      setMigratingAttachments(false);
    }
  };

  const exportZip = async () => {
    const text = getMarkdownRef.current?.() ?? plain;
    if (text === null) return;
    const confirmed = await confirmDialog({ title: "导出解锁后的笔记",
      message: "ZIP 内的正文和附件将以明文下载，请妥善保管。", confirmLabel: "导出 ZIP" });
    if (!confirmed) return;
    setAttachmentAction(null);
    const result = await exportUnlockedAttachmentZip(item.id, item.title ?? "", text);
    if (!result.ok) setAttachmentAction("导出失败，请确认笔记处于解锁状态且附件可以读取。");
  };

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
          <DocSyncStatus userId={userId} itemId={item.id} saving={saveState.kind === "saving" || migratingAttachments} dirty={dirtyTick > savedTick} saveError={saveState.kind === "error"} onRetrySave={() => { const next = getMarkdownRef.current?.() ?? plain; if (next !== null) void flush(next); }} />
          {unlocked && (
            <>
              <button type="button" className="mn-iconbtn" aria-label="加密旧附件" title="加密旧附件"
                disabled={!plainFlow || migratingAttachments} onClick={() => void migrateAttachments()}><Shield /></button>
              <button type="button" className="mn-iconbtn" aria-label="导出 ZIP（含附件）" title="导出 ZIP（含附件）"
                disabled={!plainFlow || migratingAttachments} onClick={() => void exportZip()}><Download /></button>
              <button type="button" className="mn-iconbtn" aria-label="立即锁定" title="锁定（快捷）" onClick={() => { if (inSpace) void lockPrivateSpace(userId); else lockItem(item.id); }}>
                <Lock />
              </button>
              {!inSpace && (
                <button type="button" className="mn-iconbtn" aria-label="解除本篇加密" title="解除加密（转为明文）" disabled={plain === null || migratingAttachments}
                  onClick={() => {
                    const markdown = getMarkdownRef.current?.() ?? plain;
                    if (markdown === null) return;
                    void confirmDialog({ title: "解除本篇加密", message: "解除本篇加密并转为明文？", danger: true })
                      .then((confirmed) => { if (confirmed) return decryptToPlain(userId, item.id, markdown).then(onBack); })
                      .catch((cause) => setAttachmentAction(cause instanceof Error ? cause.message : "无法解除加密，请重试。"));
                  }}>
                  <ShieldOff />
                </button>
              )}
              <span className="mn-vt" role="group" aria-label="编辑/预览切换">
                <button type="button" className={mode === "edit" ? "on" : ""} aria-label="编辑" aria-pressed={mode === "edit"} disabled={migratingAttachments} onClick={() => void switchMode("edit")}><Pencil /></button>
                <button type="button" className={mode === "preview" ? "on" : ""} aria-label="预览" aria-pressed={mode === "preview"}
                  disabled={migratingAttachments}
                  onClick={() => void switchMode("preview")}><Eye /></button>
              </span>
            </>
          )}
        </span>
      </div>
      <div className="mn-docbody" inert={migratingAttachments} ref={notePosition.scrollerRef}>
        <DocTitle value={item.title ?? ""} readOnly />
        {item.conflictOf && (
          <ConflictCompare userId={userId} copy={item} original={conflictSource} copyText={unlocked ? plain : null} onKeptOriginal={onBack} />
        )}
        {attachmentAction && <p className="mn-conflictnote" role="alert">{attachmentAction}</p>}
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
        {plainFlow && mode === "preview" && item.type !== "table" && <MarkdownView markdown={plain} attachmentItemId={item.id} className="md-body markdown-content mn-doc-preview"
          obsidian={{ userId, itemId: item.id }} />}
        {plainFlow && item.type === "table" && (
          <TableDocument
            userId={userId}
            itemId={item.id}
            markdown={plain}
            onChangeMarkdown={(next) => { plainRef.current = next; setPlain(next); setDirtyTick((n) => n + 1); }}
            onDegrade={() => { void degradeTableToNote(userId, item.id); }}
            /* 加密条目不可能是空白草稿，脚手架的切换入口不可达（守卫同 setItemForm）。 */
            onSwitchToNote={() => {}}
            readOnly={mode === "preview"}
            sealedAttachments
          />
        )}
        {plainFlow && mode === "edit" && item.type !== "table" && (
          <NoteEditor
            mode="edit"
            kind="wysiwyg"
            externalMarkdown={plain}
            onInput={() => setDirtyTick((n) => n + 1)}
            attachmentItemId={item.id}
            uploadFile={(file, onProgress) => uploadSealedAttachment(userId, item.id, file, onProgress)}
            registerGetMarkdown={(get) => { getMarkdownRef.current = get; }}
            registerCursor={notePosition.registerCursor}
            registerApplyExternal={() => {}}
          />
        )}
      </div>
    </article>
  );
}
