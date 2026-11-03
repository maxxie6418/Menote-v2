import { RAINDROP_MAX_REMOTE_ITEMS, type RaindropMappedFields } from "@menote/shared";

/** Raindrop REST 客户端（TP9，阶段 A 仅读）：分页拉取与收藏夹列表；令牌只在调用参数中传递，不落日志。 */

const API_BASE = "https://api.raindrop.io/v1";
const PAGE_SIZE = 50;

export class RaindropApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface RawRaindrop {
  _id: number;
  link: string;
  title: string;
  excerpt: string | null;
  note: string | null;
  tags: string[] | null;
  type: string | null;
  cover: string | null;
  created: string | null;
  important: boolean | null;
}

async function call<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new RaindropApiError(`raindrop_unreachable: ${String(error)}`, 0);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && typeof Reflect.get(body, "error") === "string"
      ? String(Reflect.get(body, "error")) : `raindrop_http_${response.status}`;
    throw new RaindropApiError(message, response.status);
  }
  return body as T;
}

/** 分页拉取指定收藏范围（0 = 全部）的全量书签；超出防御上限即失败（防误配拖垮表格）。 */
export async function listAllRaindrops(token: string, collectionId: number): Promise<RawRaindrop[]> {
  const items: RawRaindrop[] = [];
  for (let page = 0; page < 400; page += 1) {
    const body = await call<{ items: RawRaindrop[]; count: number }>(
      token, `/raindrops/${collectionId}?perpage=${PAGE_SIZE}&page=${page}`,
    );
    const batch = Array.isArray(body.items) ? body.items : [];
    items.push(...batch);
    if (items.length > RAINDROP_MAX_REMOTE_ITEMS) throw new RaindropApiError("raindrop_too_many_items", 0);
    if (batch.length < PAGE_SIZE) return items;
  }
  throw new RaindropApiError("raindrop_pagination_overflow", 0);
}

export interface RaindropCollection {
  id: number;
  title: string;
}

export async function listCollections(token: string): Promise<RaindropCollection[]> {
  const body = await call<{ items: Array<{ _id: number; title: string }> }>(token, "/collections");
  return (Array.isArray(body.items) ? body.items : []).map((item) => ({ id: item._id, title: item.title }));
}

/** 远端条目 → 映射字段（FR-EXT-2 字段对齐；created 即收藏创建时间，缺失回退为空）。 */
export function mapRemoteItem(raw: RawRaindrop): { remoteId: string; fields: RaindropMappedFields } {
  return {
    remoteId: String(raw._id),
    fields: {
      title: raw.title ?? "",
      link: raw.link ?? "",
      excerpt: raw.excerpt ?? "",
      note: raw.note ?? "",
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      type: raw.type ?? "link",
      cover: raw.cover ?? "",
      capturedAt: raw.created ?? "",
      important: raw.important === true,
    },
  };
}

/** 推送可回写字段（主文档 7.3：不可回写字段不得虚假承诺——type 由远端自动判定，不参与推送 diff）。 */
export const PUSH_FIELD_KEYS = ["title", "link", "excerpt", "note", "tags", "cover", "capturedAt", "important"] as const;
export type PushFieldKey = (typeof PUSH_FIELD_KEYS)[number];

/** 逐字段差异（tags 忽略大小写与顺序；capturedAt 任一侧为空/不可解析视为通配——以远端为准，
 *  不推送 created 空值覆盖；与 canonicalFields/fieldEq 同一归一口径）。 */
export function diffFieldKeys(baseline: RaindropMappedFields, current: RaindropMappedFields): PushFieldKey[] {
  const keys: PushFieldKey[] = [];
  const equal = (key: PushFieldKey) => {
    if (key === "tags") {
      return [...baseline.tags].map((tag) => tag.toLowerCase()).sort().join(",")
        === [...current.tags].map((tag) => tag.toLowerCase()).sort().join(",");
    }
    if (key === "capturedAt") {
      const ta = Date.parse(baseline.capturedAt);
      const tb = Date.parse(current.capturedAt);
      if (!Number.isFinite(ta) || !Number.isFinite(tb)) return true;
      return ta === tb;
    }
    return baseline[key] === current[key];
  };
  for (const key of PUSH_FIELD_KEYS) if (!equal(key)) keys.push(key);
  return keys;
}

/** 映射字段 → 远端载荷（只含给定键；capturedAt 映射 created）。 */
export function fieldsToRemote(fields: RaindropMappedFields, keys: readonly PushFieldKey[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === "capturedAt") payload.created = fields.capturedAt || undefined;
    else payload[key] = fields[key];
  }
  return payload;
}

/** 读取单条收藏（推送前回读比对与写后基线校准）。 */
export async function getRaindrop(token: string, id: string): Promise<{ remoteId: string; fields: RaindropMappedFields; raw: RawRaindrop }> {
  const body = await call<{ item: RawRaindrop }>(token, `/raindrop/${id}`);
  const mapped = mapRemoteItem(body.item);
  return { ...mapped, raw: body.item };
}

/** 创建单条收藏（created 映射远端创建时间）；collectionId 为 0 时省略（落默认未分类）。 */
export async function createRaindrop(
  token: string, fields: RaindropMappedFields, collectionId: number,
): Promise<{ remoteId: string }> {
  const payload: Record<string, unknown> = {
    ...fieldsToRemote(fields, PUSH_FIELD_KEYS), type: fields.type,
  };
  if (collectionId > 0) payload.collection = { $id: collectionId };
  const body = await call<{ item: { _id: number } }>(token, "/raindrop", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  return { remoteId: String(body.item._id) };
}

/** 更新单条收藏（只提交差异字段，不整条盲写）。 */
export async function updateRaindrop(token: string, id: string, fields: RaindropMappedFields, keys: readonly PushFieldKey[]): Promise<void> {
  const payload = fieldsToRemote(fields, keys);
  await call<{ item: RawRaindrop }>(token, `/raindrop/${id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
}

/** 按链接精确查找既有收藏（创建结果未知时的去重回读：全量分页扫描后精确比对，不依赖 search 语义）。 */
export async function findRaindropByLink(token: string, collectionId: number, link: string): Promise<RawRaindrop | null> {
  const items = await listAllRaindrops(token, collectionId);
  return items.find((item) => item.link === link) ?? null;
}
