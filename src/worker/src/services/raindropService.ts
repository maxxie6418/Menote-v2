import {
  RAINDROP_PUSH_CONFIRM_MIN, RAINDROP_SETTING_KEY, RAINDROP_SNAPSHOT_KEEP, normalizeRaindropSettings,
  type Item, type RaindropBindingView, type RaindropMappedFields, type RaindropPullOutcome,
  type RaindropPushOutcome, type RaindropPushPreview, type RaindropSettings, type RaindropStatusView,
} from "@menote/shared";
import { openMcpToken, sealMcpToken } from "./mcpTokenCrypto";
import { readItemState, readSettingState } from "../db/sync";
import { applyOperation } from "./syncService";
import {
  deleteAccountToken, deleteBinding, insertSyncRun, listBindings, listSyncRows, listSyncRuns, markPullDone,
  markPushDone, readAccountTokenCipher, readBinding, readRaindropTarget, upsertAccountToken, upsertBinding,
  updateSyncRowStatuses, upsertSyncRows, type RaindropBindingRow, type RaindropSyncRowRow,
} from "../db/raindrop";
import {
  RaindropApiError, createRaindrop, diffFieldKeys, findRaindropByLink, getRaindrop, listAllRaindrops,
  listCollections, mapRemoteItem, updateRaindrop, type PushFieldKey,
} from "./raindropApi";
import { backfillRowIds, fieldsFromCells, readRows, upsertRows } from "./raindropTable";
import { generateRowId } from "./tableMarkdown";

/** Raindrop 连接器编排（TP9 阶段 A：绑定 + 只读拉取 + R2 快照兜底）。
 *  安全边界：令牌密文存 D1、解密后只在调用参数中传递；写表格一律走 applyOperation（冲突不静默覆盖）。 */

export class RaindropServiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const CONNECTOR_DEVICE = "raindrop";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 规范化哈希口径：tags 忽略大小写与顺序、capturedAt 按时刻比较；type 不参与——
 *  远端自动判定该字段且不可回写（主文档 7.3：不可回写字段不得虚假承诺），参与比较会造成永久脏行。 */
function canonicalFields(fields: RaindropMappedFields): string {
  const ts = Date.parse(fields.capturedAt);
  return JSON.stringify({
    title: fields.title, link: fields.link, excerpt: fields.excerpt, note: fields.note,
    tags: [...fields.tags].map((tag) => tag.toLowerCase()).sort(), cover: fields.cover,
    capturedAt: Number.isFinite(ts) ? String(ts) : fields.capturedAt, important: fields.important,
  });
}

export async function readRaindropSettings(db: D1Database, userId: string): Promise<RaindropSettings> {
  const setting = await readSettingState(db, userId, RAINDROP_SETTING_KEY);
  return normalizeRaindropSettings(setting?.sensitivity === "ordinary" ? setting.value : undefined);
}

function bindingView(row: {
  table_item_id: string; collection_id: number; pull_interval_hours: number;
  created_at: number; updated_at: number; last_pull_at: number | null;
  last_push_at: number | null; last_snapshot_at: number | null;
}, hasToken: boolean): RaindropBindingView {
  return {
    tableItemId: row.table_item_id, collectionId: row.collection_id,
    pullIntervalHours: row.pull_interval_hours, hasToken, createdAt: row.created_at,
    updatedAt: row.updated_at, lastPullAt: row.last_pull_at, lastPushAt: row.last_push_at,
    lastSnapshotAt: row.last_snapshot_at,
  };
}

export async function readStatus(db: D1Database, userId: string): Promise<RaindropStatusView> {
  const [settings, binding, token, runs] = await Promise.all([
    readRaindropSettings(db, userId), readBinding(db, userId), readAccountTokenCipher(db, userId),
    listSyncRuns(db, userId),
  ]);
  return {
    settings,
    binding: binding ? bindingView(binding, token !== null) : null,
    runs,
  };
}

function pepper(env: Env): string {
  const value = Reflect.get(env, "AUTH_PEPPER");
  if (typeof value !== "string" || !value) throw new RaindropServiceError("auth_pepper_missing", 503);
  return value;
}

/** 保存令牌：先真实调用收藏夹接口验证，再 AES-GCM 密封入库（不回显、不进日志）。 */
export async function saveToken(env: Env, userId: string, token: string, now = Date.now()): Promise<void> {
  try {
    await listCollections(token);
  } catch (error) {
    if (error instanceof RaindropApiError && error.status === 401) {
      throw new RaindropServiceError("raindrop_token_invalid", 400);
    }
    throw new RaindropServiceError("raindrop_unreachable", 502);
  }
  await upsertAccountToken(env.DB, userId, await sealMcpToken(pepper(env), token), now);
}

export async function clearToken(db: D1Database, userId: string): Promise<void> {
  await deleteAccountToken(db, userId);
}

export interface RaindropBindInput {
  tableItemId: string;
  collectionId: number;
  pullIntervalHours: number;
}

/** 绑定表格：校验明文表格文档 → 回填「行 ID」列（一次 applyOperation）→ 落绑定配置。 */
export async function bindTable(env: Env, userId: string, input: RaindropBindInput, now = Date.now()): Promise<RaindropBindingView> {
  const cipher = await readAccountTokenCipher(env.DB, userId);
  if (!cipher) throw new RaindropServiceError("raindrop_token_missing", 409);
  const item = await readRaindropTarget(env.DB, userId, input.tableItemId);
  if (!item || item.type !== "table") throw new RaindropServiceError("raindrop_target_unavailable", 404);
  if (item.content.scope !== "plain") throw new RaindropServiceError("raindrop_target_unavailable", 404);
  const state = await readItemState(env.DB, userId, item.id);
  if (!state || state.deletedAt !== null) throw new RaindropServiceError("raindrop_target_unavailable", 404);
  const { markdown } = backfillRowIds(item.content.markdown);
  const contentHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown)))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const updated = { ...item, content: { scope: "plain" as const, markdown }, rev: state.rev, metaRev: state.metaRev, contentHash, updatedAt: now };
  const applied = await applyOperation(
    { db: env.DB, userId, deviceId: CONNECTOR_DEVICE, now },
    {
      operationId: crypto.randomUUID(), userId, entityId: item.id, entity: "item", action: "upsert",
      baseRev: state.rev, baseMetaRev: state.metaRev, contentHash, payload: { item: updated },
    },
  );
  if (applied.result !== "applied" && applied.result !== "duplicate") {
    throw new RaindropServiceError("raindrop_bind_conflict", 409);
  }
  await upsertBinding(env.DB, userId, {
    tableItemId: item.id, collectionId: input.collectionId, pullIntervalHours: input.pullIntervalHours,
  }, now);
  const row = await readBinding(env.DB, userId);
  return row ? bindingView(row, true) : bindingView({
    table_item_id: item.id, collection_id: input.collectionId, pull_interval_hours: input.pullIntervalHours,
    created_at: now, updated_at: now, last_pull_at: null, last_push_at: null, last_snapshot_at: null,
  }, true);
}

export async function unbindTable(db: D1Database, userId: string): Promise<void> {
  await deleteBinding(db, userId);
}

/** 参与三方对比的同步字段（type 由远端自动判定，不参与——主文档 7.3 不可回写字段不虚假承诺）。 */
const SYNC_KEYS = ["title", "link", "excerpt", "note", "tags", "cover", "capturedAt", "important"] as const;
type SyncKey = (typeof SYNC_KEYS)[number];

/** 字段等价：tags 忽略大小写与顺序；capturedAt 任一侧为空/不可解析视为通配（以远端为准，避免服务端
 *  生成时间造成永久脏行）；其余严格相等。 */
function fieldEq(key: SyncKey, a: RaindropMappedFields, b: RaindropMappedFields): boolean {
  if (key === "tags") {
    return [...a.tags].map((tag) => tag.toLowerCase()).sort().join(",")
      === [...b.tags].map((tag) => tag.toLowerCase()).sort().join(",");
  }
  if (key === "capturedAt") {
    const ta = Date.parse(a.capturedAt);
    const tb = Date.parse(b.capturedAt);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
    return ta === tb;
  }
  if (key === "important") return a.important === b.important;
  return a[key] === b[key];
}

/** 拉取计划（纯函数，便于测试）：远端条目 × 本地行 × 账本基线 → 逐字段三方对比。
 *  远端单侧变化的字段并入本地行（保留本地对其他字段的编辑）；同字段双侧变化 → 冲突行不覆盖；
 *  仅本地变化 → 脏行（推送阶段处理）；账本没有的远端行追加；远端消失只标记不删行。 */
export interface PullPlanRow { rowId: string; fields: RaindropMappedFields }
export interface PullPlanLedger { menoteRowId: string; raindropId: string; baselineHash: string; baselineJson: string; status: string }
export interface PullPlan {
  appends: Array<{ rowId: string; remoteId: string; fields: RaindropMappedFields }>;
  updates: Array<{ rowId: string; remoteId: string; fields: RaindropMappedFields }>;
  ledgerUpserts: Array<{ menoteRowId: string; raindropId: string; baselineJson: string; baselineHash: string; status: "synced" }>;
  statusUpdates: Array<{ menoteRowId: string; status: "conflict" | "dirty" | "orphaned" | "remote_missing" }>;
  counts: { pulledNew: number; pulledUpdated: number; conflicts: number; remoteMissing: number; orphans: number; skipped: number };
}

export async function planPull(
  rows: PullPlanRow[], ledgerRows: PullPlanLedger[], remote: Array<{ remoteId: string; fields: RaindropMappedFields }>,
): Promise<PullPlan> {
  const plan: PullPlan = {
    appends: [], updates: [], ledgerUpserts: [], statusUpdates: [],
    counts: { pulledNew: 0, pulledUpdated: 0, conflicts: 0, remoteMissing: 0, orphans: 0, skipped: 0 },
  };
  const rowByRowId = new Map(rows.map((row) => [row.rowId, row]));
  const ledgerByRemote = new Map(ledgerRows.map((entry) => [entry.raindropId, entry]));
  const seenRemote = new Set<string>();
  const baselineOf = (entry: PullPlanLedger, remoteFields: RaindropMappedFields): RaindropMappedFields => {
    try {
      const parsed = JSON.parse(entry.baselineJson) as Partial<RaindropMappedFields>;
      return { ...remoteFields, ...parsed } as RaindropMappedFields;
    } catch { return remoteFields; }
  };
  for (const item of remote) {
    seenRemote.add(item.remoteId);
    const ledger = ledgerByRemote.get(item.remoteId);
    if (!ledger) {
      const rowId = generateRowId();
      plan.appends.push({ rowId, remoteId: item.remoteId, fields: item.fields });
      plan.ledgerUpserts.push({
        menoteRowId: rowId, raindropId: item.remoteId,
        baselineJson: canonicalFields(item.fields), baselineHash: await sha256Hex(canonicalFields(item.fields)),
        status: "synced",
      });
      plan.counts.pulledNew += 1;
      continue;
    }
    const row = rowByRowId.get(ledger.menoteRowId);
    if (!row) {
      plan.statusUpdates.push({ menoteRowId: ledger.menoteRowId, status: "orphaned" });
      plan.counts.orphans += 1;
      continue;
    }
    const baseline = baselineOf(ledger, item.fields);
    const merged: RaindropMappedFields = { ...row.fields };
    let remoteChanged = false;
    let localChanged = false;
    let conflicted = false;
    for (const key of SYNC_KEYS) {
      const rowSame = fieldEq(key, row.fields, baseline);
      const remoteSame = fieldEq(key, item.fields, baseline);
      if (!remoteSame && rowSame) {
        remoteChanged = true;
        Reflect.set(merged, key, item.fields[key]);
      } else if (!rowSame && remoteSame) {
        localChanged = true;
      } else if (!rowSame && !remoteSame) {
        if (fieldEq(key, row.fields, item.fields)) {
          // 回声：行内容已等于远端（如上轮写行成功但账本未及更新）→ 收敛即可。
          remoteChanged = true;
          Reflect.set(merged, key, item.fields[key]);
        } else {
          conflicted = true;
        }
      }
    }
    if (conflicted) {
      plan.statusUpdates.push({ menoteRowId: ledger.menoteRowId, status: "conflict" });
      plan.counts.conflicts += 1;
      continue;
    }
    if (remoteChanged) {
      plan.updates.push({ rowId: ledger.menoteRowId, remoteId: item.remoteId, fields: merged });
      // 基线记为合并后行内容：本地编辑保留、空缺字段以通配参与后续比较。
      plan.ledgerUpserts.push({
        menoteRowId: ledger.menoteRowId, raindropId: item.remoteId,
        baselineJson: canonicalFields(merged), baselineHash: await sha256Hex(canonicalFields(merged)),
        status: "synced",
      });
      plan.counts.pulledUpdated += 1;
      continue;
    }
    if (localChanged) {
      plan.statusUpdates.push({ menoteRowId: ledger.menoteRowId, status: "dirty" });
      continue;
    }
    plan.counts.skipped += 1;
  }
  for (const ledger of ledgerRows) {
    if (seenRemote.has(ledger.raindropId)) continue;
    plan.statusUpdates.push({
      menoteRowId: ledger.menoteRowId,
      status: rowByRowId.has(ledger.menoteRowId) ? "remote_missing" : "orphaned",
    });
    if (rowByRowId.has(ledger.menoteRowId)) plan.counts.remoteMissing += 1;
    else plan.counts.orphans += 1;
  }
  return plan;
}

/** 远端原始 JSON 快照写 R2（内容 hash 复用、保留最近 RAINDROP_SNAPSHOT_KEEP 份；缺 BUCKET 时跳过不阻断）。 */
async function writeSnapshot(
  env: Env, userId: string, binding: { last_snapshot_hash: string | null; last_snapshot_key: string | null; last_snapshot_at: number | null },
  collectionId: number, rawItems: unknown[], now: number,
): Promise<{ key: string | null; hash: string | null; at: number | null }> {
  const bucket = Reflect.get(env, "BUCKET") as R2Bucket | undefined;
  if (!bucket || typeof bucket.put !== "function") return { key: null, hash: null, at: null };
  const payload = JSON.stringify({ pulledAt: new Date(now).toISOString(), collectionId, items: rawItems });
  const hash = await sha256Hex(payload);
  if (hash === binding.last_snapshot_hash) {
    return { key: binding.last_snapshot_key, hash, at: binding.last_snapshot_at };
  }
  const key = `raindrop/${userId}/${String(now).padStart(15, "0")}.json`;
  await bucket.put(key, payload);
  const listing = await bucket.list({ prefix: `raindrop/${userId}/` });
  const stale = listing.objects.map((object) => object.key).sort().reverse().slice(RAINDROP_SNAPSHOT_KEEP);
  for (const old of stale) await bucket.delete(old);
  return { key, hash, at: now };
}

/** 读取绑定表当前内容与账本（拉取/推送共用；目标必须仍是本人明文表格文档）。 */
interface SyncContext {
  binding: RaindropBindingRow;
  item: Item & { content: { scope: "plain"; markdown: string } };
  state: NonNullable<Awaited<ReturnType<typeof readItemState>>>;
  rows: PullPlanRow[];
  ledgerRows: PullPlanLedger[];
}

async function loadSyncContext(env: Env, userId: string): Promise<SyncContext> {
  const binding = await readBinding(env.DB, userId);
  if (!binding) throw new RaindropServiceError("raindrop_not_bound", 409);
  const item = await readRaindropTarget(env.DB, userId, binding.table_item_id);
  if (!item || item.content.scope !== "plain") throw new RaindropServiceError("raindrop_target_unavailable", 409);
  const state = await readItemState(env.DB, userId, item.id);
  if (!state || state.deletedAt !== null) throw new RaindropServiceError("raindrop_target_unavailable", 409);
  // SQL 已限定 type='table' 且 content_ciphertext IS NULL；守卫后再收窄给下游使用。
  const plainItem = item as Item & { content: { scope: "plain"; markdown: string } };
  const rows = readRows(plainItem.content.markdown)
    .filter((row): row is { rowId: string; cells: Record<string, string> } => row.rowId !== null)
    .map((row) => ({ rowId: row.rowId, fields: fieldsFromCells(row.cells) }));
  const ledgerRows = (await listSyncRows(env.DB, userId)).map((row) => ({
    menoteRowId: row.menote_row_id, raindropId: row.raindrop_id, baselineHash: row.baseline_hash,
    baselineJson: row.baseline_json, status: row.status,
  }));
  return { binding, item: plainItem, state, rows, ledgerRows };
}

/** 执行一轮拉取：拉远端 → 快照 → 计划 → 单次表格写入（冲突即失败不落盘）→ 账本对齐 → 运行记录。 */
export async function runPull(env: Env, userId: string, source: "scheduled" | "manual"): Promise<RaindropPullOutcome> {
  const startedAt = Date.now();
  const counts = { pulledNew: 0, pulledUpdated: 0, conflicts: 0, remoteMissing: 0, orphans: 0, skipped: 0 };
  try {
    const binding = await readBinding(env.DB, userId);
    if (!binding) throw new RaindropServiceError("raindrop_not_bound", 409);
    if (!(await readRaindropSettings(env.DB, userId)).enabled) {
      throw new RaindropServiceError("raindrop_connector_disabled", 409);
    }
    const cipher = await readAccountTokenCipher(env.DB, userId);
    if (!cipher) throw new RaindropServiceError("raindrop_token_missing", 409);
    const token = await openMcpToken(pepper(env), cipher);
    const rawItems = await listAllRaindrops(token, binding.collection_id);
    const remote = rawItems.map(mapRemoteItem);
    const snapshot = await writeSnapshot(env, userId, binding, binding.collection_id, rawItems, startedAt);

    const { item, state, rows, ledgerRows } = await loadSyncContext(env, userId);
    const plan = await planPull(rows, ledgerRows, remote);
    Object.assign(counts, plan.counts);

    if (plan.appends.length || plan.updates.length) {
      const markdown = upsertRows(item.content.markdown, plan.updates, plan.appends);
      const contentHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(markdown)))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const updated = { ...item, content: { scope: "plain" as const, markdown }, rev: state.rev, metaRev: state.metaRev, contentHash, updatedAt: startedAt };
      const applied = await applyOperation(
        { db: env.DB, userId, deviceId: CONNECTOR_DEVICE, now: startedAt },
        {
          operationId: crypto.randomUUID(), userId, entityId: item.id, entity: "item", action: "upsert",
          baseRev: state.rev, baseMetaRev: state.metaRev, contentHash, payload: { item: updated },
        },
      );
      if (applied.result !== "applied" && applied.result !== "duplicate") {
        throw new RaindropServiceError("raindrop_pull_write_conflict", 409);
      }
    }
    await upsertSyncRows(env.DB, userId, plan.ledgerUpserts.map((entry) => ({
      user_id: userId, menote_row_id: entry.menoteRowId, raindrop_id: entry.raindropId,
      baseline_json: entry.baselineJson, baseline_hash: entry.baselineHash, status: entry.status, updated_at: startedAt,
    })));
    await updateSyncRowStatuses(env.DB, userId, plan.statusUpdates, startedAt);
    await markPullDone(env.DB, userId, snapshot, startedAt);
    const status = counts.conflicts > 0 ? "partial" : "ok";
    await insertSyncRun(env.DB, userId, {
      direction: "pull", source, startedAt, finishedAt: Date.now(), status, ...counts,
      pushCreated: 0, pushUpdated: 0, pushFailed: 0,
      detail: counts.conflicts > 0 ? "存在冲突行，保留本地待人工处理" : null,
    });
    return counts;
  } catch (error) {
    const unauthorized = error instanceof RaindropApiError && error.status === 401;
    await insertSyncRun(env.DB, userId, {
      direction: "pull", source, startedAt, finishedAt: Date.now(), status: "failed", ...counts,
      pushCreated: 0, pushUpdated: 0, pushFailed: 0,
      detail: unauthorized ? "raindrop_token_unauthorized" : String(error).slice(0, 500),
    }).catch(() => { /* 记录失败不掩盖原错误 */ });
    if (unauthorized) throw new RaindropServiceError("raindrop_token_unauthorized", 401);
    throw error;
  }
}

/** 推送计划（纯函数）：未绑定行 → 创建；已绑定且内容 ≠ 基线 → 更新（执行时回读远端再定夺）；
 *  远端已消失的绑定行默认不重建（防止意外重复创建）；本地删行（账本 orphaned）不在行列表中自然跳过。 */
export interface PushPlanRow { rowId: string; fields: RaindropMappedFields }
export interface PushPlanLedger { menoteRowId: string; raindropId: string; baselineHash: string; baselineJson: string; status: string }
export interface PushPlan {
  creates: Array<{ rowId: string; fields: RaindropMappedFields }>;
  updates: Array<{ rowId: string; raindropId: string; fields: RaindropMappedFields; baselineFields: RaindropMappedFields; diffKeys: PushFieldKey[] }>;
  skipsRemoteMissing: Array<{ rowId: string; raindropId: string }>;
  cleanCount: number;
}

export async function planPush(rows: PushPlanRow[], ledgerRows: PushPlanLedger[]): Promise<PushPlan> {
  const plan: PushPlan = { creates: [], updates: [], skipsRemoteMissing: [], cleanCount: 0 };
  const ledgerByRow = new Map(ledgerRows.map((entry) => [entry.menoteRowId, entry]));
  for (const row of rows) {
    const ledger = ledgerByRow.get(row.rowId);
    if (!ledger) {
      plan.creates.push({ rowId: row.rowId, fields: row.fields });
      continue;
    }
    if (ledger.status === "orphaned") { plan.cleanCount += 1; continue; }
    if (ledger.status === "remote_missing") {
      plan.skipsRemoteMissing.push({ rowId: row.rowId, raindropId: ledger.raindropId });
      continue;
    }
    const rowHash = await sha256Hex(canonicalFields(row.fields));
    if (rowHash === ledger.baselineHash) { plan.cleanCount += 1; continue; }
    let baselineFields: RaindropMappedFields;
    try { baselineFields = JSON.parse(ledger.baselineJson) as RaindropMappedFields; }
    catch { baselineFields = row.fields; }
    plan.updates.push({
      rowId: row.rowId, raindropId: ledger.raindropId, fields: row.fields,
      baselineFields, diffKeys: diffFieldKeys(baselineFields, row.fields),
    });
  }
  return plan;
}

/** 熔断阈值：待推条数超过 max(下限常量, 绑定行数一半) 时必须二次确认。 */
export function pushThreshold(totalRows: number): number {
  return Math.max(RAINDROP_PUSH_CONFIRM_MIN, Math.ceil(totalRows / 2));
}

/** 差异预览（不触远端）：基于账本基线给出将创建/将更新/远端已消失三段清单。 */
export async function previewPush(env: Env, userId: string): Promise<RaindropPushPreview> {
  const { rows, ledgerRows } = await loadSyncContext(env, userId);
  const plan = await planPush(rows, ledgerRows);
  const fieldsByRow = new Map(rows.map((row) => [row.rowId, row.fields]));
  const creates = plan.creates.map((entry) => ({ rowId: entry.rowId, title: entry.fields.title, link: entry.fields.link }));
  const updates = plan.updates.map((entry) => ({
    rowId: entry.rowId, raindropId: entry.raindropId,
    title: entry.fields.title, link: entry.fields.link, diffKeys: entry.diffKeys,
  }));
  const remoteMissing = plan.skipsRemoteMissing.map((entry) => ({
    rowId: entry.rowId, raindropId: entry.raindropId, title: fieldsByRow.get(entry.rowId)?.title ?? "",
  }));
  const totalChanges = creates.length + updates.length;
  return {
    creates, updates, remoteMissing, totalChanges,
    requiresConfirm: totalChanges > pushThreshold(rows.length), threshold: pushThreshold(rows.length),
  };
}

const PUSH_PACE_BATCH = 20;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 执行反推（阶段 B）：预览确认后逐条调用单条接口，只推差异字段；
 *  更新前回读远端与基线逐字段比对（远端有新改动 → 标记冲突跳过，不静默覆盖）；
 *  成功后以行内容规范化快照为新基线——tags 大小写、空缺采集时间经等价通配吸收服务端归一，不产生永久脏行；
 *  创建结果未知时按 URL 全量扫描绑定既有 _id，绝不重复创建；每 20 次请求节流 1 秒。 */
export async function runPush(env: Env, userId: string, options: { confirm: boolean }): Promise<RaindropPushOutcome> {
  const startedAt = Date.now();
  const counts: RaindropPushOutcome = { pushCreated: 0, pushUpdated: 0, conflicts: 0, pushFailed: 0, skipped: 0 };
  const ledgerUpserts: RaindropSyncRowRow[] = [];
  const statusUpdates: Array<{ menoteRowId: string; status: RaindropSyncRowRow["status"] }> = [];
  let apiCalls = 0;
  const pace = async () => { apiCalls += 1; if (apiCalls % PUSH_PACE_BATCH === 0) await sleep(1_000); };
  const ledgerFromFields = async (menoteRowId: string, raindropId: string, fields: RaindropMappedFields): Promise<RaindropSyncRowRow> => {
    const canonical = canonicalFields(fields);
    return {
      user_id: userId, menote_row_id: menoteRowId, raindrop_id: raindropId,
      baseline_json: canonical, baseline_hash: await sha256Hex(canonical), status: "synced", updated_at: startedAt,
    };
  };
  try {
    const { binding, rows, ledgerRows } = await loadSyncContext(env, userId);
    if (!(await readRaindropSettings(env.DB, userId)).enabled) {
      throw new RaindropServiceError("raindrop_connector_disabled", 409);
    }
    const cipher = await readAccountTokenCipher(env.DB, userId);
    if (!cipher) throw new RaindropServiceError("raindrop_token_missing", 409);
    const token = await openMcpToken(pepper(env), cipher);
    const plan = await planPush(rows, ledgerRows);
    const total = plan.creates.length + plan.updates.length;
    if (total > pushThreshold(rows.length) && !options.confirm) {
      throw new RaindropServiceError("raindrop_push_confirm_required", 409);
    }
    const ledgerByRow = new Map(ledgerRows.map((entry) => [entry.menoteRowId, entry]));

    for (const entry of plan.creates) {
      try {
        await pace();
        const created = await createRaindrop(token, entry.fields, binding.collection_id);
        // 基线记为行内容规范化快照：空缺字段（如未填采集时间）经通配等价吸收服务端生成值，不产生永久脏行。
        ledgerUpserts.push(await ledgerFromFields(entry.rowId, created.remoteId, entry.fields));
        counts.pushCreated += 1;
      } catch (error) {
        const recoverable = error instanceof RaindropApiError && (error.status === 0 || error.status >= 500);
        if (!recoverable) { counts.pushFailed += 1; continue; }
        try {
          await pace();
          const existing = await findRaindropByLink(token, binding.collection_id, entry.fields.link);
          if (!existing) { counts.pushFailed += 1; continue; }
          ledgerUpserts.push(await ledgerFromFields(entry.rowId, String(existing._id), entry.fields));
          counts.pushCreated += 1;
        } catch { counts.pushFailed += 1; }
      }
    }

    for (const entry of plan.updates) {
      try {
        await pace();
        const remote = await getRaindrop(token, entry.raindropId);
        const ledger = ledgerByRow.get(entry.rowId);
        let baselineFields: RaindropMappedFields;
        try {
          baselineFields = { ...remote.fields, ...(JSON.parse(ledger?.baselineJson ?? "{}") as Partial<RaindropMappedFields>) } as RaindropMappedFields;
        } catch { baselineFields = remote.fields; }
        const drifted = SYNC_KEYS.some((key) => !fieldEq(key, remote.fields, baselineFields));
        if (!ledger || drifted) {
          statusUpdates.push({ menoteRowId: entry.rowId, status: "conflict" });
          counts.conflicts += 1;
          continue;
        }
        const diffKeys = diffFieldKeys(entry.baselineFields, entry.fields);
        if (diffKeys.length === 0) {
          ledgerUpserts.push(await ledgerFromFields(entry.rowId, entry.raindropId, entry.fields));
          counts.skipped += 1;
          continue;
        }
        await pace();
        await updateRaindrop(token, entry.raindropId, entry.fields, diffKeys);
        ledgerUpserts.push(await ledgerFromFields(entry.rowId, entry.raindropId, entry.fields));
        counts.pushUpdated += 1;
      } catch { counts.pushFailed += 1; }
    }

    counts.skipped += plan.skipsRemoteMissing.length;
    if (ledgerUpserts.length) await upsertSyncRows(env.DB, userId, ledgerUpserts);
    await updateSyncRowStatuses(env.DB, userId, statusUpdates, startedAt);
    await markPushDone(env.DB, userId, startedAt);
    const status = counts.conflicts > 0 || counts.pushFailed > 0 ? "partial" : "ok";
    await insertSyncRun(env.DB, userId, {
      direction: "push", source: "manual", startedAt, finishedAt: Date.now(), status,
      pulledNew: 0, pulledUpdated: 0, conflicts: counts.conflicts, remoteMissing: 0, orphans: 0,
      pushCreated: counts.pushCreated, pushUpdated: counts.pushUpdated, pushFailed: counts.pushFailed,
      detail: counts.pushFailed > 0 ? `存在 ${counts.pushFailed} 条失败，账本未动可重试` : null,
    });
    return counts;
  } catch (error) {
    await insertSyncRun(env.DB, userId, {
      direction: "push", source: "manual", startedAt, finishedAt: Date.now(), status: "failed",
      pulledNew: 0, pulledUpdated: 0, conflicts: counts.conflicts, remoteMissing: 0, orphans: 0,
      pushCreated: counts.pushCreated, pushUpdated: counts.pushUpdated, pushFailed: counts.pushFailed,
      detail: String(error).slice(0, 500),
    }).catch(() => { /* 记录失败不掩盖原错误 */ });
    throw error;
  }
}

/** cron 入口：遍历全部绑定，开关关闭/未到期/无令牌跳过；单绑定失败不阻断其余。 */
export async function runScheduledPulls(env: Env, now = Date.now()): Promise<void> {
  for (const binding of await listBindings(env.DB)) {
    try {
      if (!(await readRaindropSettings(env.DB, binding.user_id)).enabled) continue;
      if (binding.last_pull_at !== null && now - binding.last_pull_at < binding.pull_interval_hours * 3_600_000 - 30_000) continue;
      await runPull(env, binding.user_id, "scheduled");
    } catch (error) {
      console.error("raindrop_pull failed:", binding.user_id, error);
    }
  }
}
