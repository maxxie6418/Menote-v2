import { useEffect, useState } from "react";
import { RAINDROP_INTERVAL_HOURS, type RaindropPushPreview, type RaindropStatusView } from "@menote/shared";
import {
  bindRaindropTable, clearRaindropToken, previewRaindropPush, pullRaindropNow, pushRaindropNow,
  readRaindropStatus, saveRaindropToken, unbindRaindropTable,
} from "../../services/raindropService";

const INTERVAL_LABELS: Record<number, string> = { 1: "每小时", 6: "每 6 小时", 24: "每天" };
const DIFF_LABELS: Record<string, string> = {
  title: "标题", link: "网址", excerpt: "摘要", note: "备注", tags: "标签",
  cover: "封面", capturedAt: "采集时间", important: "重要",
};
const PREVIEW_RENDER_LIMIT = 8;

function formatTime(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

/** 目标输入兼容三种写法：`/n/<短 ID>` 链接、旧路径链接、裸 Item ID。 */
function parseTableItemId(raw: string): string {
  const match = /[A-Za-z0-9_-]{22}/.exec(raw);
  return match ? match[0] : raw.trim();
}

function runSummary(run: RaindropStatusView["runs"][number]): string {
  if (run.direction === "pull") {
    return `新增 ${run.pulledNew} · 更新 ${run.pulledUpdated} · 冲突 ${run.conflicts} · 远端消失 ${run.remoteMissing} · 行已删 ${run.orphans}`;
  }
  return `创建 ${run.pushCreated} · 更新 ${run.pushUpdated} · 失败 ${run.pushFailed}`;
}

const STATUS_LABELS = { ok: "成功", partial: "部分完成", failed: "失败" } as const;

/** Raindrop 连接器面板（TP9 阶段 A）：令牌、绑定、立即拉取、同步记录与快照信息。 */
export function RaindropPanel() {
  const [status, setStatus] = useState<RaindropStatusView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [targetDraft, setTargetDraft] = useState("");
  const [collectionDraft, setCollectionDraft] = useState("0");
  const [intervalDraft, setIntervalDraft] = useState<number>(1);
  const [preview, setPreview] = useState<RaindropPushPreview | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const refresh = (signal?: AbortSignal) => {
    void readRaindropStatus(signal).then((value) => { if (value) setStatus(value); }).catch(() => {});
  };

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, []);

  const run = async (action: () => Promise<void>, successText: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      setMessage(successText);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const binding = status?.binding ?? null;
  const runs = status?.runs ?? [];

  return (
    <div>
      {message && <p className="mn-mcp-message" role="status">{message}</p>}

      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">Raindrop 访问令牌</p>
          <p className="mn-sethint">
            在 Raindrop 设置 → Integrations → For Developer 创建 Test Token 后粘贴；加密存储、默认不显示，可清除后重填。
          </p>
        </div>
        {binding?.hasToken
          ? <button type="button" className="mn-statuslink" disabled={busy}
              onClick={() => void run(() => clearRaindropToken(), "令牌已清除")}>清除令牌</button>
          : null}
      </div>
      <div className="mn-setrow">
        <input type="password" className="mn-propselect" aria-label="Raindrop 访问令牌" autoComplete="off"
          placeholder={binding?.hasToken ? "已保存（粘贴新值可覆盖）" : "粘贴 Raindrop Test Token"}
          value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} />
        <button type="button" className="app-button" disabled={busy || !tokenDraft.trim()}
          onClick={() => void run(async () => { await saveRaindropToken(tokenDraft.trim()); setTokenDraft(""); }, "令牌已保存（已通过远端验证）")}>
          保存令牌
        </button>
      </div>

      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">绑定中间件表格</p>
          <p className="mn-sethint">
            指定一张多维表格文档（支持 /n/ 短链接或文档 ID）；绑定时会自动补「行 ID」列并回填存量行。
            收藏范围填收藏夹 ID（0 = 全部）；拉取频率为定时自动执行。
          </p>
        </div>
      </div>
      <div className="mn-setrow">
        <input type="text" className="mn-propselect" aria-label="表格链接或 ID" placeholder="/n/xxxxxxxxxxxxxxxxxxxxxx 或文档 ID"
          value={targetDraft} onChange={(event) => setTargetDraft(event.target.value)} />
        <input type="number" className="mn-propselect" aria-label="收藏夹 ID" min={0} value={collectionDraft}
          onChange={(event) => setCollectionDraft(event.target.value)} />
        <select className="mn-propselect" aria-label="拉取频率" value={intervalDraft}
          onChange={(event) => setIntervalDraft(Number(event.target.value))}>
          {RAINDROP_INTERVAL_HOURS.map((hours) => (
            <option key={hours} value={hours}>{INTERVAL_LABELS[hours] ?? `${hours} 小时`}</option>
          ))}
        </select>
      </div>
      <div className="mn-setrow">
        {binding
          ? <>
              <button type="button" className="app-button" disabled={busy}
                onClick={() => void run(async () => {
                  await bindRaindropTable({
                    tableItemId: parseTableItemId(targetDraft), collectionId: Math.max(0, Number.parseInt(collectionDraft, 10) || 0),
                    pullIntervalHours: intervalDraft,
                  });
                  setTargetDraft("");
                }, "绑定已更新")}>更新绑定</button>
              <button type="button" className="mn-statuslink" disabled={busy}
                onClick={() => void run(() => unbindRaindropTable(), "已解绑（表格内容保留）")}>解绑</button>
              <button type="button" className="app-button" disabled={busy}
                onClick={() => void run(async () => {
                  const outcome = await pullRaindropNow();
                  setMessage(`拉取完成：新增 ${outcome.pulledNew}、更新 ${outcome.pulledUpdated}、冲突 ${outcome.conflicts}、远端消失 ${outcome.remoteMissing}、跳过 ${outcome.skipped}`);
                  refresh();
                }, "")}>立即拉取</button>
            </>
          : <button type="button" className="app-button" disabled={busy || !targetDraft.trim()}
              onClick={() => void run(async () => {
                await bindRaindropTable({
                  tableItemId: parseTableItemId(targetDraft), collectionId: Math.max(0, Number.parseInt(collectionDraft, 10) || 0),
                  pullIntervalHours: intervalDraft,
                });
                setTargetDraft("");
              }, "绑定成功，可在下方手动拉取或等待定时执行")}>绑定</button>}
      </div>

      {binding
        ? <div className="mn-setrow">
            <div>
              <p className="mn-setlabel">当前绑定</p>
              <p className="mn-sethint">
                表格 {binding.tableItemId} · 收藏范围 {binding.collectionId === 0 ? "全部" : `收藏夹 ${binding.collectionId}`}
                · 频率 {INTERVAL_LABELS[binding.pullIntervalHours] ?? `${binding.pullIntervalHours} 小时`}
                · 上次拉取 {formatTime(binding.lastPullAt)} · 上次推送 {formatTime(binding.lastPushAt)}
                · 最新快照 {formatTime(binding.lastSnapshotAt)}（远端原始 JSON 留存 R2，作风险兜底）
              </p>
            </div>
          </div>
        : <p className="mn-sethint">尚未绑定表格；绑定后定时拉取才会执行。</p>}

      {binding
        ? <>
            <div className="mn-setrow">
              <div>
                <p className="mn-setlabel">反推云端备份（手动确认）</p>
                <p className="mn-sethint">
                  基于同步基线计算差异：未绑定行将创建、已修改行将更新（只推差异字段）；推送前逐条回读远端，
                  远端有新改动时标记冲突跳过，不静默覆盖；远端已消失的行默认不重建。本地删除不会删除远端。
                </p>
              </div>
              <button type="button" className="app-button" disabled={busy}
                onClick={() => void run(async () => {
                  const value = await previewRaindropPush();
                  setPreview(value);
                  setConfirmChecked(false);
                  if (!value) setMessage("预览为空");
                }, "")}>预览推送差异</button>
            </div>
            {preview
              ? <div className="mn-setrow">
                  <div>
                    <p className="mn-sethint">
                      将创建 {preview.creates.length} 条 · 将更新 {preview.updates.length} 条
                      · 远端已消失 {preview.remoteMissing.length} 条（跳过）
                      {preview.requiresConfirm ? ` · ⚠ 数量超过阈值 ${preview.threshold}，请勾选确认` : ""}
                    </p>
                    {preview.creates.slice(0, PREVIEW_RENDER_LIMIT).map((entry) => (
                      <p key={entry.rowId} className="mn-sethint">＋ {entry.title || "(无标题)"} — {entry.link}</p>
                    ))}
                    {preview.creates.length > PREVIEW_RENDER_LIMIT && <p className="mn-sethint">…等共 {preview.creates.length} 条将创建</p>}
                    {preview.updates.slice(0, PREVIEW_RENDER_LIMIT).map((entry) => (
                      <p key={entry.rowId} className="mn-sethint">
                        ↻ {entry.title || "(无标题)"}（{entry.diffKeys.map((key) => DIFF_LABELS[key] ?? key).join("、") || "无字段变化"}）
                      </p>
                    ))}
                    {preview.updates.length > PREVIEW_RENDER_LIMIT && <p className="mn-sethint">…等共 {preview.updates.length} 条将更新</p>}
                    {preview.requiresConfirm
                      ? <label className="mn-sethint">
                          <input type="checkbox" checked={confirmChecked}
                            onChange={(event) => setConfirmChecked(event.target.checked)} /> 我确认本次大量推送（{preview.totalChanges} 条）是有意的
                        </label>
                      : null}
                    <button type="button" className="app-button" disabled={busy || !preview.totalChanges
                      || (preview.requiresConfirm && !confirmChecked)}
                      onClick={() => void run(async () => {
                        const outcome = await pushRaindropNow(true);
                        setPreview(null);
                        setMessage(`推送完成：创建 ${outcome.pushCreated}、更新 ${outcome.pushUpdated}、冲突 ${outcome.conflicts}、失败 ${outcome.pushFailed}、跳过 ${outcome.skipped}`);
                        refresh();
                      }, "")}>确认推送到 Raindrop</button>
                  </div>
                </div>
              : null}
          </>
        : null}

      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">最近同步记录</p>
          {runs.length === 0
            ? <p className="mn-sethint">暂无记录；绑定并拉取后逐次登记推/拉条数与冲突。</p>
            : <ul className="mn-mcp-token-list">
                {runs.map((run) => (
                  <li key={run.id} className="mn-sethint">
                    {formatTime(run.finishedAt)} · {run.direction === "pull" ? "拉取" : "推送"}
                    （{run.source === "manual" ? "手动" : "定时"}）· {STATUS_LABELS[run.status]}
                    · {runSummary(run)}{run.detail ? ` · ${run.detail}` : ""}
                  </li>
                ))}
              </ul>}
        </div>
      </div>
    </div>
  );
}
