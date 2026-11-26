import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import type { LucideIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { InfoHint } from "../../components/ui/InfoHint";
import { Button } from "../../components/ui/button";
import { X } from "../../icons";

interface PluginSettingsRowProps {
  name: string;
  description: string;
  icon: LucideIcon;
  mobile: boolean;
  enabled: boolean | null;
  saving: boolean;
  readFailed: boolean;
  saveFailed: boolean;
  onToggle: (enabled: boolean) => void;
  onRetry: () => void;
  renderConfig: (active: boolean) => ReactNode;
}

export function PluginSettingsRow({ name, description, icon: Icon, mobile, enabled, saving, readFailed, saveFailed,
  onToggle, onRetry, renderConfig }: PluginSettingsRowProps) {
  const status = saving ? "正在保存…" : readFailed ? "读取失败" : enabled === null ? "正在读取…" : enabled ? "已启用" : "已停用";

  return <li className="mn-plugin-row" data-mobile={mobile}>
    <span className="mn-plugin-icon"><Icon aria-hidden="true" /></span>
    <h3 className="mn-plugin-name">{name}<InfoHint>{description}</InfoHint></h3>
    <div className="mn-plugin-actions">
      <Switch.Root className="mn-plugin-switch" aria-label={`启用 ${name}`} checked={enabled === true}
        disabled={enabled === null || saving || readFailed} onCheckedChange={onToggle}>
        <span className="mn-plugin-switch-track" aria-hidden="true"><Switch.Thumb className="mn-plugin-switch-thumb" /></span>
        <span aria-hidden="true">{status}</span>
      </Switch.Root>
      {enabled && !readFailed
        ? <PluginConfig name={name} mobile={mobile} disabled={saving} renderConfig={renderConfig} />
        : <Button type="button" variant="ghost" className="mn-textbtn mn-settings-outline" aria-label={`配置 ${name}`} disabled>配置</Button>}
    </div>
    {(readFailed || saveFailed) && <p className="mn-plugin-error mn-settings-notice is-error" role="alert">
      {readFailed ? "无法读取插件状态。" : "无法保存插件状态，请重试。"}
      {readFailed && <button type="button" className="mn-statuslink" onClick={onRetry}>重新读取</button>}
    </p>}
  </li>;
}

function PluginConfig({ name, mobile, disabled, renderConfig }: Pick<PluginSettingsRowProps, "name" | "mobile" | "renderConfig"> & { disabled: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  return <Dialog.Root open={open} onOpenChange={(next) => {
    if (next) setHasOpened(true);
    setOpen(next);
  }}>
    <Dialog.Trigger render={<Button variant="ghost" className="mn-textbtn mn-settings-outline" aria-label={`配置 ${name}`} />} disabled={disabled}>配置</Dialog.Trigger>
    <Dialog.Portal keepMounted={hasOpened}>
      <Dialog.Viewport className="mn-overlay mn-plugin-dialog-layer" data-mobile={mobile}>
        <Dialog.Popup className="mn-dialog mn-plugin-dialog" initialFocus={heading}>
          <header className="mn-dlg-head mn-settings-header">
            <div className="mn-settings-header-title"><Dialog.Title ref={heading} tabIndex={-1}>{name}</Dialog.Title></div>
            <Dialog.Close className="mn-iconbtn" aria-label="关闭插件配置"><X aria-hidden="true" /></Dialog.Close>
          </header>
          <div className="mn-dlg-content mn-plugin-dialog-content">
            <div className="mn-settings-page">{hasOpened && renderConfig(open)}</div>
          </div>
        </Dialog.Popup>
      </Dialog.Viewport>
    </Dialog.Portal>
  </Dialog.Root>;
}
