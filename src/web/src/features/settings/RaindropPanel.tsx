import { useEffect, useMemo, useState, type ClipboardEvent } from "react";
import { RAINDROP_INTERVAL_HOURS, resolveItemId, type Item, type RaindropCollectionOption, type RaindropPushPreview, type RaindropStatusView, type TopicNode } from "@menote/shared";
import { useHomeSnapshot } from "../../services/contentHooks";
import { flushSync } from "../../services/syncEngine";
import {
  bindRaindropTable, clearRaindropToken, previewRaindropPush, pullRaindropNow, pushRaindropNow, readRaindropCollections,
  readRaindropStatus, saveRaindropToken, unbindRaindropTable,
} from "../../services/raindropService";
import { loadShared, peek, SETTINGS_CACHE } from "../../services/settingsPrefetch";
import { InfoHint } from "../../components/ui/InfoHint";

const INTERVAL_LABELS: Record<number, string> = { 1: "每小时", 6: "每 6 小时", 24: "每天" };
const DIFF_LABELS: Record<string, string> = {
  title: "标题", link: "网址", excerpt: "摘要", note: "备注", tags: "标签",
  cover: "封面", capturedAt: "采集时间", important: "重要",
};
const PREVIEW_RENDER_LIMIT = 8;

function formatTime(value: number | null): string {
  return value === null ? "—" : new Date(value).toLocaleString();
}

function isInterval(value: number): value is 1 | 6 | 24 {
  return (RAINDROP_INTERVAL_HOURS as readonly number[]).includes(value);
}

/** 私人空间整棵排除：服务端拒绝 in_enc_space，锁定与否都不可绑。 */
function privateTopicIds(topics: TopicNode[]): Set<string> {
  const roots = new Set(topics.filter((topic) => topic.isEncSpace).map((topic) => topic.id));
  return new Set(topics.filter((topic) => topic.isEncSpace || (topic.parentId !== null && roots.has(topic.parentId))).map((topic) => topic.id));
}

function bindableTables(items: Item[], topics: TopicNode[]): Item[] {
  const blocked = privateTopicIds(topics);
  return items
    .filter((item) => item.type === "table" && item.deletedAt === null && item.content.scope === "plain"
      && (item.topicId === null || !blocked.has(item.topicId)))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function topicLabel(item: Item, topics: TopicNode[]): string {
  if (!item.topicId) return "未归类";
  return topics.find((topic) => topic.id === item.topicId)?.name ?? "未归类";
}

function runSummary(run: RaindropStatusView["runs"][number]): string {
  if (run.direction === "pull") {
    return `新增 ${run.pulledNew} · 更新 ${run.pulledUpdated} · 冲突 ${run.conflicts} · 远端消失 ${run.remoteMissing} · 行已删 ${run.orphans}`;
  }
  return `创建 ${run.pushCreated} · 更新 ${run.pushUpdated} · 失败 ${run.pushFailed}`;
}

function runDetailText(detail: string | null): string {
  if (detail === "raindrop_token_unauthorized" || /unauthorized/i.test(detail ?? "")) {
    return "Raindrop 拒绝了读取请求，请重新生成 Test Token 并保存";
  }
  return detail ?? "";
}

const STATUS_LABELS = { ok: "成功", partial: "部分完成", failed: "失败" } as const;

/** Raindrop 连接器面板（TP9）：令牌、搜索选取表格、立即拉取、同步记录与快照信息。 */
export function RaindropPanel({ userId }: { userId: string }) {
  const snapshot = useHomeSnapshot(userId);
  const tables = useMemo(() => bindableTables(snapshot.items, snapshot.topics), [snapshot.items, snapshot.topics]);
  const [status, setStatus] = useState<RaindropStatusView | null>(() => peek<RaindropStatusView | null>(SETTINGS_CACHE.raindropStatus) ?? null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");
  const [collections, setCollections] = useState<RaindropCollectionOption[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState("0");
  const [intervalDraft, setIntervalDraft] = useState<number>(1);
  const [preview, setPreview] = useState<RaindropPushPreview | null>(null);
  const [confirmChecked, setConfirmChecked] = useState(false);

  const refresh = (fresh = false) => {
    void loadShared(SETTINGS_CACHE.raindropStatus, () => readRaindropStatus(), fresh).then((value) => { if (value) setStatus(value); }).catch(() => undefined);
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    if (!status?.hasToken) return;
    void readRaindropCollections().then(setCollections).catch((error) => {
      setCollections([]);
      setMessage(error instanceof Error ? error.message : "收藏夹读取失败");
    });
  }, [status?.hasToken]);

  const binding = status?.binding ?? null;

  useEffect(() => {
    if (seeded || !binding) return;
    setCollectionDraft(String(binding.collectionId));
    if (isInterval(binding.pullIntervalHours)) setIntervalDraft(binding.pullIntervalHours);
    if (binding.tableItemId) setSelectedId(binding.tableItemId);
    setSeeded(true);
  }, [binding, seeded]);

  useEffect(() => {
    const resolved = query.trim() ? resolveItemId(query) : "";
    if (resolved && tables.some((item) => item.id === resolved)) setSelectedId(resolved);
  }, [query, tables]);

  const run = async (action: () => Promise<void>, successText: string) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (successText) setMessage(successText);
      refresh(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const validateAndSaveToken = (token: string) => void run(async () => {
    const available = await saveRaindropToken(token);
    setCollections(available);
    setTokenDraft("");
    setMessage(`令牌验证成功并已保存${available.length ? `，已读取 ${available.length} 个收藏夹` : ""}`);
  }, "");

  const handleTokenPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text").trim();
    if (!pasted) return;
    event.preventDefault();
    setTokenDraft("");
    validateAndSaveToken(pasted);
  };

  const runs = status?.runs ?? [];
  const needle = query.trim().toLowerCase();
  const resolvedQuery = query.trim() ? resolveItemId(query) : "";
  const shown = tables.filter((item) => {
    if (!needle) return true;
    if (item.id === resolvedQuery) return true;
    return (item.title ?? "").toLowerCase().includes(needle) || topicLabel(item, snapshot.topics).toLowerCase().includes(needle);
  });
  const selected = tables.find((item) => item.id === selectedId);
  const bound = tables.find((item) => item.id === binding?.tableItemId);

  const submitBind = () => {
    if (!selectedId) return;
    void run(async () => {
      await flushSync(userId);
      await bindRaindropTable({
        tableItemId: selectedId,
        collectionId: Math.max(0, Number.parseInt(collectionDraft, 10) || 0),
        pullIntervalHours: intervalDraft,
      });
      setQuery("");
      setPulling(true);
      try {
        const outcome = await pullRaindropNow();
        setMessage(`连接成功并完成首次拉取：新增 ${outcome.pulledNew}、更新 ${outcome.pulledUpdated}、冲突 ${outcome.conflicts}`);
      } finally {
        setPulling(false);
      }
    }, "");
  };

  return (
    <div>
      {message && <p className="mn-mcp-message" role="status">{message}</p>}

      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">Raindrop 访问令牌<InfoHint>
            粘贴 Test Token 后自动验证并加密保存；也可手动输入后点“验证并保存”。令牌不会显示或回传。
          </InfoHint></p>
        </div>
        {status?.hasToken
          ? <button type="button" className="mn-statuslink" disabled={busy}
              onClick={() => void run(async () => { await clearRaindropToken(); setCollections([]); }, "令牌已清除")}>清除令牌</button>
          : null}
      </div>
      <div className="mn-setrow">
        <input type="password" className="mn-propselect" aria-label="Raindrop 访问令牌" autoComplete="off"
          placeholder={status?.hasToken ? "已验证（粘贴新令牌可替换）" : "粘贴 Raindrop Test Token"}
          value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} onPaste={handleTokenPaste} />
        <button type="button" className="app-button" disabled={busy || !tokenDraft.trim()}
          onClick={() => validateAndSaveToken(tokenDraft.trim())}>
          验证并保存
        </button>
      </div>

      <div className="mn-setrow">
        <div>
          <p className="mn-setlabel">绑定中间件表格<InfoHint>
            搜索并点选一张明文多维表格。也可以把复制的 /n/ 链接贴进搜索框，会自动对上那张表。
            选择后点“连接并拉取”；系统会补齐「行 ID」列并自动完成首轮拉取。
          </InfoHint></p>
        </div>
      </div>
      <div className="mn-tablepick">
        <input type="search" className="mn-propselect" aria-label="搜索表格" placeholder="搜索表格标题，或粘贴 /n/ 链接"
          value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="mn-sethint">
          {selected
            ? `已选：${selected.title || "无标题"}`
            : selectedId ? "已选当前绑定（本机列表里暂时没有这张表）" : "请选择一张表格"}
        </p>
        <div className="mn-tablepick-list" role="listbox" aria-label="可绑定的表格">
          {shown.length === 0
            ? <p className="mn-sethint">没有可绑定的明文表格。先新建一张不在私人空间里的多维表格。</p>
            : shown.map((item) => (
              <button key={item.id} type="button" role="option" aria-selected={item.id === selectedId}
                className={item.id === selectedId ? "on" : ""} onClick={() => setSelectedId(item.id)}>
                <span>{item.title || "无标题"}</span>
                <span>{topicLabel(item, snapshot.topics)}</span>
              </button>
            ))}
        </div>
      </div>
      <div className="mn-setrow">
        <select className="mn-propselect" aria-label="Raindrop 收藏范围" value={collectionDraft}
          onChange={(event) => setCollectionDraft(event.target.value)}>
          <option value="0">全部收藏（默认）</option>
          {collectionDraft !== "0" && !collections.some((entry) => String(entry.id) === collectionDraft)
            ? <option value={collectionDraft}>当前收藏夹（{collectionDraft}）</option> : null}
          {collections.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select>
        <details className="mn-raindrop-advanced">
          <summary>自动拉取频率：{INTERVAL_LABELS[intervalDraft]}</summary>
          <select className="mn-propselect" aria-label="拉取频率" value={intervalDraft}
            onChange={(event) => setIntervalDraft(Number(event.target.value))}>
            {RAINDROP_INTERVAL_HOURS.map((hours) => (
              <option key={hours} value={hours}>{INTERVAL_LABELS[hours] ?? `${hours} 小时`}</option>
            ))}
          </select>
        </details>
      </div>
      <div className="mn-setrow">
        <button type="button" className="app-button" disabled={busy || !selectedId || !status?.hasToken} onClick={submitBind}>
          {pulling ? "正在连接并拉取…" : binding ? "保存并拉取" : "连接并拉取"}
        </button>
        {binding
          ? <>
              <button type="button" className="mn-statuslink" disabled={busy}
                onClick={() => void run(() => unbindRaindropTable(), "已解绑（表格内容保留）")}>解绑</button>
              <button type="button" className="app-button" disabled={busy}
                onClick={() => void run(async () => {
                  setPulling(true);
                  try {
                    const outcome = await pullRaindropNow();
                    setMessage(`拉取完成：新增 ${outcome.pulledNew}、更新 ${outcome.pulledUpdated}、冲突 ${outcome.conflicts}、远端消失 ${outcome.remoteMissing}、跳过 ${outcome.skipped}`);
                  } finally {
                    setPulling(false);
                  }
                }, "")}>{pulling ? "正在拉取…" : "立即拉取"}</button>
            </>
          : null}
      </div>

      {pulling && <div className="mn-raindrop-progress" role="status" aria-live="polite">
        <span>正在从 Raindrop 读取收藏并同步到表格，请稍候。</span>
        <div className="mn-raindrop-progress-track" role="progressbar" aria-label="Raindrop 拉取进度"
          aria-valuetext="正在读取远端收藏并更新本地表格" />
      </div>}

      {binding
        ? <div className="mn-setrow">
            <div>
              <p className="mn-setlabel">当前绑定</p>
              <p className="mn-sethint">
                表格 {bound?.title || binding.tableItemId} · 收藏范围 {binding.collectionId === 0 ? "全部" : `收藏夹 ${binding.collectionId}`}
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
                <p className="mn-setlabel">反推云端备份（手动确认）<InfoHint>
                  基于同步基线计算差异：未绑定行将创建、已修改行将更新（只推差异字段）；推送前逐条回读远端，
                  远端有新改动时标记冲突跳过，不静默覆盖；远端已消失的行默认不重建。本地删除不会删除远端。
                </InfoHint></p>
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
                    · {runSummary(run)}{run.detail ? ` · ${runDetailText(run.detail)}` : ""}
                  </li>
                ))}
              </ul>}
        </div>
      </div>
    </div>
  );
}
