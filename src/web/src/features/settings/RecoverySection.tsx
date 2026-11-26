import { useEffect, useState } from "react";
import { InfoHint } from "../../components/ui/InfoHint";
import { useEncryptedCount } from "../../services/contentHooks";
import { findPrivateSpace, privateSpaceReady } from "../../services/privateSpaceService";
import { readAppearance, updateAppearance } from "../../services/appearanceSettingsService";
import { RecoveryCodeSettings } from "./RecoveryCodeSettings";
import { SettingsGroup } from "./SettingsGroup";

/** 恢复码说明区（FR-ENC-6：明文仅启用时展示一次；轮换 UI 随 G7 遗留排期）。 */
export function RecoverySection({ userId }: { userId: string }) {
  const encryptedCount = useEncryptedCount(userId);
  const [memoAccessGate, setMemoAccessGate] = useState(false);
  const [spaceReady, setSpaceReady] = useState(false);
  const [gateLoading, setGateLoading] = useState(true);
  const [gateSaving, setGateSaving] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const appearance = await readAppearance(userId);
        const space = await findPrivateSpace(userId);
        const ready = space ? await privateSpaceReady(space.id) : false;
        if (cancelled) return;
        setMemoAccessGate(appearance?.memoAccessGate === true);
        setSpaceReady(ready);
        setGateError(null);
      } catch {
        if (!cancelled) setGateError("无法读取 Memo 入口保护设置。");
      } finally {
        if (!cancelled) setGateLoading(false);
      }
    };
    void refresh();
    window.addEventListener("menote:appearance", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("menote:appearance", refresh);
    };
  }, [userId]);

  const changeMemoAccessGate = async (enabled: boolean) => {
    if (enabled && !spaceReady) return;
    setGateSaving(true);
    setGateError(null);
    const previous = memoAccessGate;
    setMemoAccessGate(enabled);
    try {
      await updateAppearance(userId, { memoAccessGate: enabled });
    } catch {
      setMemoAccessGate(previous);
      setGateError("保存失败，请重试。");
    } finally {
      setGateSaving(false);
    }
  };

  return (
    <div className="mn-settings-stack">
      <RecoveryCodeSettings key={userId} userId={userId} encryptedCount={encryptedCount} />
      <SettingsGroup title="Memo 入口">
        <div className="mn-setrow">
          <div>
            <p className="mn-setlabel">Memo 入口口令保护<InfoHint>每次进入 Memo 页面前验证私人空间密码。此设置只拦截前端入口，不加密 Memo 正文或附件。</InfoHint></p>
            <p className="mn-sethint">{spaceReady ? "Memo 正文与附件仍按普通内容明文存储和同步。" : memoAccessGate ? "本机暂缺私人空间密码包装；同步私人空间后可验证，也可在此关闭保护。" : "需先设置私人空间密码，才能启用此入口保护。"}</p>
          </div>
          <select
            className="mn-propselect"
            aria-label="Memo 入口口令保护"
            value={memoAccessGate ? "on" : "off"}
            disabled={gateLoading || gateSaving || (!spaceReady && !memoAccessGate)}
            onChange={(event) => void changeMemoAccessGate(event.target.value === "on")}
          >
            <option value="off">关闭</option>
            <option value="on">使用私人空间密码</option>
          </select>
        </div>
        {gateError && <p className="mn-auth-error" role="alert">{gateError}</p>}
      </SettingsGroup>
    </div>
  );
}
