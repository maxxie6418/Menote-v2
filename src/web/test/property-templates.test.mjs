import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const bundle = await build({
  stdin: {
    contents: `export { localDb } from "./src/db/localDb";
               export { readPropertyTemplates, savePropertyTemplates, normalizePropertyTemplates, DEFAULT_PROPERTY_TEMPLATES }
                 from "./src/services/propertyTemplateService";
               export { readPropRows, writeDef, writeValue, removeProp, removePropDef, PROPS_KEY } from "./src/lib/frontmatter";
               export { BOOKMARK_COLUMNS } from "@menote/shared";`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, format: "esm", platform: "browser",
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const {
  localDb, readPropertyTemplates, savePropertyTemplates, normalizePropertyTemplates, DEFAULT_PROPERTY_TEMPLATES,
  readPropRows, writeDef, writeValue, removeProp, removePropDef, PROPS_KEY, BOOKMARK_COLUMNS,
} = mod;

const USER = "user-a";

async function reset() {
  await Promise.all(localDb.tables.map((table) => table.clear()));
}

test("默认属性预设：未配置时给出厂预设，保存后随账号设置存取", async () => {
  await reset();
  const presets = await readPropertyTemplates(USER);
  assert.ok(presets.length >= 8, "出厂预设应覆盖剪藏/Raindrop/通用三类");
  assert.ok(presets.some((item) => item.type === "select" && item.options && item.options.length > 0));

  await savePropertyTemplates(USER, presets.slice(0, 2));
  const saved = await readPropertyTemplates(USER);
  assert.equal(saved.length, 2);
  // 设置随账号同步：本地设置 + outbox 一条
  const setting = await localDb.settings.get([USER, "propertyTemplates"]);
  assert.equal(setting.sensitivity, "ordinary");
  assert.equal(setting.value.length, 2);
  const rows = await localDb.outbox.where("userId").equals(USER).toArray();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity, "setting");
  assert.equal(rows[0].entityId, "propertyTemplates");
});

test("预设键名口径：Raindrop 组用连接器标准列名，其余用英文键 + 中文显示名", async () => {
  await reset();
  const presets = await readPropertyTemplates(USER);
  // Raindrop：连接器按列名读写，键名必须与标准列一致，否则拉回的数据落错列
  const raindrop = presets.filter((item) => item.group === "Raindrop").map((item) => item.name);
  assert.deepEqual(raindrop, BOOKMARK_COLUMNS.map((column) => column.name));
  // 其余：英文键（Obsidian 惯例）+ 中文显示名，导出/迁移不用改键
  const general = presets.filter((item) => item.group === "通用");
  assert.ok(general.length >= 4);
  for (const item of general) {
    assert.match(item.name, /^[a-z][a-zA-Z]*$/);
    assert.ok(item.label, `${item.name} 应带中文显示名`);
  }
});

test("预设清洗：丢掉结构不对的项，缺 id 的补一个", () => {
  const cleaned = normalizePropertyTemplates([
    { id: "a", name: "状态", type: "select", options: ["进行中"], value: "进行中" },
    { name: "作者", type: "text" },
    { name: "", type: "text" },
    { name: "坏的", type: "不存在的类型" },
    "不是对象",
  ]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].id, "a");
  assert.ok(cleaned[1].id.length > 0);
  assert.equal(cleaned[1].name, "作者");
});

test("只定义没有值的属性也要列出来（清空值后属性仍在，可再填）", () => {
  let markdown = writeDef("正文", PROPS_KEY, "状态", { type: "select", options: ["未开始", "进行中"] });
  // 新建定义时按第一个候选写入初值
  assert.equal(readPropRows(markdown, PROPS_KEY)[0].raw, "未开始");
  // 清空值后属性不应从面板消失（否则定义成了看不见的残渣）
  markdown = removeProp(markdown, "状态");
  const rows = readPropRows(markdown, PROPS_KEY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw, "");
  assert.deepEqual(rows[0].def.options, ["未开始", "进行中"]);
  // 删除属性：值与定义一起去掉
  const removed = removePropDef(markdown, PROPS_KEY, "状态");
  assert.equal(readPropRows(removed, PROPS_KEY).length, 0);
});

test("新增属性：定义与默认值一次写回，互不覆盖", () => {
  let markdown = writeDef("正文", PROPS_KEY, "状态", { type: "select", options: ["未开始", "进行中"] });
  markdown = writeValue(markdown, "状态", "进行中");
  const rows = readPropRows(markdown, PROPS_KEY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].raw, "进行中");
  assert.equal(rows[0].def.type, "select");
});
