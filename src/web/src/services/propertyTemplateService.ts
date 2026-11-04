import type { UserSetting } from "@menote/shared";
import { BOOKMARK_COLUMNS, PROPERTY_TEMPLATES_SETTING_KEY } from "@menote/shared";
import { localDb } from "../db/localDb";
import { enqueueOutbox } from "../db/outboxRepo";
import { newId } from "../lib/hash";
import type { PropertyTemplate, PropertyType } from "../lib/frontmatter";

/**
 * 默认属性模板库（FR-PROP-9）：设置里可配、随账号同步。
 * 预设只作「添加属性」时的模板库——加进文档后即成为该文档自己的设定，
 * 之后预设怎么改都不回写既有文档；文档里的增删改也不会反写预设。
 */

/**
 * 出厂预设：剪藏 / Raindrop / Obsidian 通用三族。
 * 键名口径（FR-PROP-9）：**键名是可互通的机器名，显示名才是中文**——
 *  · Raindrop 组直接用连接器写死的标准列名（标题/网址/摘要/备注/标签/类型/封面/采集时间/重要），
 *    连接器按列名读写，换名就认不出；
 *  · 其余用 Obsidian 社区惯例的英文键（status/author/created/source…），与 Obsidian 库里的
 *    既有属性同名，迁移或导出过去不用改键。
 */
export const DEFAULT_PROPERTY_TEMPLATES: PropertyTemplate[] = [
  // Raindrop 标准列：与连接器共享同一份定义，避免两处漂移。
  ...BOOKMARK_COLUMNS.map((column) => ({
    id: `raindrop-${column.name}`,
    name: column.name,
    type: column.type as PropertyType,
    ...(column.options ? { options: [...column.options] } : {}),
    group: "Raindrop",
  })),
  { id: "clip-source", name: "source", type: "link", label: "来源链接", group: "剪藏" },
  { id: "clip-author", name: "author", type: "text", label: "作者", group: "剪藏" },
  { id: "clip-site", name: "site", type: "text", label: "站点", group: "剪藏" },
  { id: "clip-published", name: "publishedAt", type: "date", label: "发布时间", group: "剪藏" },
  { id: "clip-captured", name: "capturedAt", type: "date", label: "采集时间", group: "剪藏" },
  { id: "obs-status", name: "status", type: "select", label: "状态", options: ["未开始", "进行中", "已完成", "已搁置"], value: "未开始", group: "通用" },
  { id: "obs-author", name: "author", type: "text", label: "作者", group: "通用" },
  { id: "obs-created", name: "created", type: "date", label: "创建时间", group: "通用" },
  { id: "obs-project", name: "project", type: "text", label: "项目", group: "通用" },
  { id: "obs-priority", name: "priority", type: "select", label: "优先级", options: ["高", "中", "低"], value: "中", group: "通用" },
];

/** 设置里存的值做一次清洗：丢掉结构不对的项，避免脏数据进 UI。 */
export function normalizePropertyTemplates(value: unknown): PropertyTemplate[] {
  if (!Array.isArray(value)) return [];
  const templates: PropertyTemplate[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Partial<PropertyTemplate>;
    if (typeof item.name !== "string" || !item.name.trim()) continue;
    const type = item.type;
    if (type !== "text" && type !== "multiline" && type !== "number" && type !== "date"
      && type !== "select" && type !== "multiselect" && type !== "checkbox" && type !== "link") continue;
    const options = Array.isArray(item.options) ? item.options.filter((option): option is string => typeof option === "string") : undefined;
    const value0 = typeof item.value === "boolean" || typeof item.value === "string"
      || (Array.isArray(item.value) && item.value.every((entry2) => typeof entry2 === "string"))
      ? item.value : undefined;
    templates.push({
      id: typeof item.id === "string" && item.id ? item.id : newId(),
      name: item.name.trim(),
      type,
      ...(typeof item.label === "string" && item.label ? { label: item.label } : {}),
      ...(options && options.length ? { options } : {}),
      ...(value0 !== undefined ? { value: value0 } : {}),
      ...(typeof item.group === "string" && item.group ? { group: item.group } : {}),
    });
  }
  return templates;
}

/** 读取账号的默认属性模板；未配置过时返回出厂预设。 */
export async function readPropertyTemplates(userId: string): Promise<PropertyTemplate[]> {
  const current = await localDb.settings.get([userId, PROPERTY_TEMPLATES_SETTING_KEY]);
  if (!current || current.sensitivity !== "ordinary") return DEFAULT_PROPERTY_TEMPLATES;
  const templates = normalizePropertyTemplates(current.value);
  return templates.length ? templates : DEFAULT_PROPERTY_TEMPLATES;
}

/** 保存默认属性模板（随账号同步）；写回本地设置并入队上传。 */
export async function savePropertyTemplates(userId: string, templates: PropertyTemplate[]): Promise<void> {
  const value = normalizePropertyTemplates(templates);
  await localDb.transaction("rw", localDb.settings, localDb.outbox, async () => {
    const current = await localDb.settings.get([userId, PROPERTY_TEMPLATES_SETTING_KEY]);
    const queued = (await localDb.outbox.where("userId").equals(userId).toArray())
      .filter((row) => row.entity === "setting" && row.entityId === PROPERTY_TEMPLATES_SETTING_KEY)
      .sort((a, b) => a.seq! - b.seq!);
    const baseRev = queued[0]?.baseRev ?? current?.rev ?? 0;
    const setting: UserSetting = {
      userId, key: PROPERTY_TEMPLATES_SETTING_KEY, sensitivity: "ordinary",
      value, rev: baseRev + 1, updatedAt: Date.now(),
    };
    await localDb.settings.put(setting);
    if (queued.length) await localDb.outbox.bulkDelete(queued.map((row) => row.seq!));
    await enqueueOutbox([{
      operationId: newId(), userId, entityId: PROPERTY_TEMPLATES_SETTING_KEY, entity: "setting", action: "upsert",
      baseRev, baseMetaRev: 0, payload: { setting }, queuedAt: Date.now(), retries: 0,
      nextRetryAt: null, lastError: null,
    }]);
  });
  void import("./syncEngine").then(({ requestSync }) => requestSync(userId));
}

/** 拉取到服务端版本时覆盖本地预设（本机仍有待推操作则不覆盖）。 */
export async function applyPulledPropertyTemplates(userId: string, settings: UserSetting[]): Promise<void> {
  const found = settings.find((setting) => setting.key === PROPERTY_TEMPLATES_SETTING_KEY);
  if (!found || found.sensitivity !== "ordinary") return;
  const remote = found;
  const pending = await localDb.outbox.where("userId").equals(userId)
    .and((row) => row.entity === "setting" && row.entityId === PROPERTY_TEMPLATES_SETTING_KEY).count();
  if (pending > 0) return;
  const templates = normalizePropertyTemplates(remote.value);
  if (!templates.length) return;
  await localDb.settings.put({ ...remote, value: templates });
}
