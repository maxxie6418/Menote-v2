import { Component, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ChevronLeft, ChevronRight, Folder, Link, Palette, Paperclip, RefreshCw, Settings, Shield, SlidersHorizontal, Sparkles, Type, X } from "../../icons";
import { readAiAvailability } from "../../services/aiService";
import { AppearanceSection } from "./AppearanceSection";
import { AttachmentPolicySettings } from "./AttachmentPolicySettings";

const AiSection = lazy(() => import("./AiSection").then(module => ({ default: module.AiSection })));
const AttachmentListPanel = lazy(() => import("../attachments").then(module => ({ default: module.AttachmentListPanel })));
const BackupPanel = lazy(() => import("../backup").then(module => ({ default: module.BackupPanel })));
const ClipTemplateManager = lazy(() => import("./ClipTemplateManager").then(module => ({ default: module.ClipTemplateManager })));
const DataSection = lazy(() => import("./DataSection").then(module => ({ default: module.DataSection })));
const EditorSection = lazy(() => import("./EditorSection").then(module => ({ default: module.EditorSection })));
const McpTokenManager = lazy(() => import("./McpTokenManager").then(module => ({ default: module.McpTokenManager })));
const PluginSection = lazy(() => import("./PluginSection").then(module => ({ default: module.PluginSection })));
const PropertyTemplatePanel = lazy(() => import("./PropertyTemplatePanel").then(module => ({ default: module.PropertyTemplatePanel })));
const RecoverySection = lazy(() => import("./RecoverySection").then(module => ({ default: module.RecoverySection })));
const StyleSection = lazy(() => import("./StyleSection").then(module => ({ default: module.StyleSection })));
const SyncLogSection = lazy(() => import("./SyncLogSection").then(module => ({ default: module.SyncLogSection })));
const SyncSection = lazy(() => import("./SyncSection").then(module => ({ default: module.SyncSection })));

class SettingsPageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed
      ? <p className="mn-settings-empty" role="alert">此页暂时无法载入。请在连接恢复后刷新页面。</p>
      : <Suspense fallback={<p className="mn-settings-empty" role="status">正在载入设置…</p>}>{this.props.children}</Suspense>;
  }
}

const SECTIONS = {
  appearance: { title: "外观", icon: Palette },
  editor: { title: "编辑器", icon: Type },
  backup: { title: "备份与恢复", icon: Archive },
  sync: { title: "同步", icon: RefreshCw },
  mcp: { title: "MCP 接入", icon: Link },
  data: { title: "数据", icon: Folder },
  style: { title: "阅读排版", icon: Palette, parent: "appearance" },
  propertyTemplates: { title: "默认属性", icon: SlidersHorizontal, parent: "editor" },
  syncLogs: { title: "同步日志", icon: RefreshCw, parent: "sync" },
  attachments: { title: "附件管理", icon: Paperclip, parent: "data" },
  recovery: { title: "恢复码", icon: Shield },
  ai: { title: "AI 助手", icon: Sparkles },
  clipTemplates: { title: "剪藏模板", icon: SlidersHorizontal },
  plugins: { title: "插件", icon: Settings },
} as const;

type SettingsPage = keyof typeof SECTIONS;
export type SettingsSection = SettingsPage | "overview";

const NAV_GROUPS = [
  { label: "使用偏好", entries: ["appearance", "editor"] },
  { label: "数据与连接", entries: ["backup", "sync", "mcp", "data"] },
  { label: "高级", entries: ["recovery", "ai", "clipTemplates", "plugins"] },
] as const;

interface SettingsDialogProps {
  userId: string;
  section: SettingsSection;
  mobile: boolean;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  onOpenTrash: () => void;
}

export function SettingsDialog({ userId, section, mobile, onClose, onSectionChange, onOpenTrash }: SettingsDialogProps) {
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const positions = useRef<Partial<Record<SettingsPage, number>>>({});
  const previousPage = useRef<SettingsPage | null>(null);
  const page = section === "overview" ? "appearance" : section;
  const [hasOpenedBackup, setHasOpenedBackup] = useState(page === "backup");
  const active = SECTIONS[page];
  const parent = "parent" in active ? active.parent : null;
  const directory = mobile && section === "overview";
  const title = directory ? "设置" : active.title;
  const backupActive = page === "backup" && !directory;

  useEffect(() => {
    if (backupActive) setHasOpenedBackup(true);
  }, [backupActive]);

  useEffect(() => {
    const controller = new AbortController();
    void readAiAvailability(controller.signal).then(value => {
      if (!controller.signal.aborted) setAiAvailable(value);
    });
    return () => controller.abort();
  }, []);

  useLayoutEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (directory) {
      const last = previousPage.current;
      const link = last ? dialog.current?.querySelector<HTMLElement>('[data-settings-page="' + last + '"]') : null;
      (link ?? heading.current)?.focus({ preventScroll: true });
      return;
    }
    const scroller = content.current;
    if (scroller) scroller.scrollTop = positions.current[page] ?? 0;
    previousPage.current = parent ?? page;
    if (mobile || !dialog.current?.contains(document.activeElement) || scroller?.contains(document.activeElement)) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [directory, mobile, page, parent]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.getElementById("mn-confirm-title")) return;
      if (event.target instanceof Element && event.target.closest(".mn-plugin-dialog")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
      if (event.key !== "Tab" || !dialog.current) return;
      const available = Array.from(dialog.current.querySelectorAll<HTMLElement>(
        "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex='0']",
      )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0);
      const first = available.at(0);
      const last = available.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changeSection = (next: SettingsSection) => {
    if (content.current) positions.current[page] = content.current.scrollTop;
    onSectionChange(next);
  };

  const header = <header className="mn-dlg-head mn-settings-header">
    <div className="mn-settings-header-title">
      {(parent || (mobile && !directory)) && <button type="button" className="mn-iconbtn"
        aria-label={parent ? "返回" + SECTIONS[parent].title : "返回设置目录"}
        onClick={() => changeSection(parent ?? "overview")}><ChevronLeft /></button>}
      <h2 ref={heading} tabIndex={-1}>{title}</h2>
    </div>
    <button type="button" className="mn-iconbtn" aria-label="关闭设置" onClick={onClose}><X /></button>
  </header>;

  return (
    <div className="mn-overlay mn-settings-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="mn-dialog mn-dialog-settings mn-settings-workspace" data-directory={directory} data-mobile={mobile}
        role="dialog" aria-modal="true" aria-label="设置" ref={dialog}>
        {directory && header}
        {(!mobile || directory) && <nav className="mn-dlg-nav" aria-label="设置分类">
          {!mobile && <p className="mn-settings-rail-title">设置</p>}
          {NAV_GROUPS.map(group => (
            <div className="mn-settings-nav-group" key={group.label}>
              <p className="mn-nav-label">{group.label}</p>
              {group.entries.filter(entry => entry !== "ai" || aiAvailable).map(entry => {
                const { icon: Icon, title: label } = SECTIONS[entry];
                return (
                  <a key={entry} href={"/settings/" + entry} data-settings-page={entry}
                    aria-current={!directory && (entry === page || entry === parent) ? "page" : undefined}
                    onClick={event => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      if (entry !== section) changeSection(entry);
                    }}>
                    <Icon aria-hidden="true" /><span>{label}</span><ChevronRight className="mn-settings-nav-chevron" aria-hidden="true" />
                  </a>
                );
              })}
            </div>
          ))}
        </nav>}
        <div className="mn-settings-main">
          {!directory && header}
          {(hasOpenedBackup || backupActive) && <div className="mn-dlg-content" hidden={!backupActive} ref={backupActive ? content : undefined}
            onScroll={event => { if (backupActive) positions.current.backup = event.currentTarget.scrollTop; }}>
            <div className="mn-settings-page"><SettingsPageBoundary>
              <BackupPanel userId={userId} active={backupActive} />
            </SettingsPageBoundary></div>
          </div>}
          {!directory && !backupActive && <div className="mn-dlg-content" ref={content} key={page} onScroll={(event) => {
            positions.current[page] = event.currentTarget.scrollTop;
          }}>
            <div className="mn-settings-page">
              <SettingsPageBoundary>
                {page === "appearance" && <AppearanceSection userId={userId} onOpenStyles={() => changeSection("style")} />}
                {page === "editor" && <EditorSection userId={userId} onOpenTemplates={() => changeSection("propertyTemplates")} />}
                {page === "sync" && <SyncSection userId={userId} onOpenLogs={() => changeSection("syncLogs")} />}
                {page === "mcp" && <McpTokenManager userId={userId} />}
                {page === "data" && <DataSection userId={userId} onOpenAttachments={() => changeSection("attachments")} onOpenTrash={onOpenTrash} />}
                {page === "style" && <StyleSection userId={userId} />}
                {page === "propertyTemplates" && <PropertyTemplatePanel userId={userId} />}
                {page === "attachments" && <><AttachmentPolicySettings userId={userId} /><AttachmentListPanel userId={userId} /></>}
                {page === "syncLogs" && <SyncLogSection userId={userId} />}
                {page === "recovery" && <RecoverySection userId={userId} />}
                {page === "ai" && (aiAvailable ? <AiSection userId={userId} /> : <p className="mn-settings-empty" role="status">{aiAvailable === null ? "正在检查可用性…" : "此实例尚未配置 AI 助手。"}</p>)}
                {page === "clipTemplates" && <ClipTemplateManager />}
                {page === "plugins" && <PluginSection userId={userId} mobile={mobile} />}
              </SettingsPageBoundary>
            </div>
          </div>}
        </div>
      </div>
    </div>
  );
}
