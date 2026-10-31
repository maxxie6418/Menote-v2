/* ============================================================================
 * 演示数据（M1.2 结构还原专用）
 * ----------------------------------------------------------------------------
 * 本文件全部内容为界面结构演示样例，取自设计原型 wiki/design.html，
 * 不是真实笔记、真实主题或真实账户数据，不进入任何数据库或同步链路。
 * 正式数据将在 M2 完成认证、同步与恢复演练后接入。
 * ==========================================================================*/

export const DEMO_NOTICE = "演示数据";

export interface DemoTopic {
  id: string;
  name: string;
  depth: 0 | 1;
  parentId?: string;
  expanded?: boolean;
  locked?: boolean;
  lockedLabel?: string;
}

export const demoTopics: DemoTopic[] = [
  { id: "t-game", name: "游戏美术", depth: 0, expanded: true },
  { id: "t-ue5", name: "UE5", depth: 1, parentId: "t-game" },
  { id: "t-houdini", name: "Houdini", depth: 1, parentId: "t-game" },
  { id: "t-product", name: "产品设计", depth: 0 },
  { id: "t-reading", name: "阅读清单", depth: 0 },
  { id: "t-idea", name: "灵感收集", depth: 0 },
  { id: "t-archive", name: "归档", depth: 0 },
  { id: "t-study", name: "学习笔记", depth: 0 },
  { id: "t-travel", name: "旅行计划", depth: 0 },
  { id: "t-private", name: "私人空间", depth: 0, locked: true, lockedLabel: "锁定" },
];

export const demoTags = [
  { name: "材质", count: 8 },
  { name: "光照", count: 5 },
  { name: "工作流", count: 3 },
];

export type DemoNoteKind = "note" | "table" | "locked";

export interface DemoNote {
  id: string;
  title: string;
  summary: string;
  time: string;
  kind: DemoNoteKind;
  group: string;
}

export const demoNotes: DemoNote[] = [
  { id: "n-1", title: "材质工作流", summary: "基础层只负责底色与粗糙度，细节层控制磨损位置", time: "14:02", kind: "note", group: "最近" },
  { id: "n-2", title: "场景灯光规范", summary: "Lumen 与烘焙的分界，取决于是否需要动态时间", time: "昨天", kind: "locked", group: "最近" },
  { id: "n-3", title: "程序化资产拆分", summary: "Houdini 出片与引擎内参数化的取舍", time: "周二", kind: "note", group: "最近" },
  { id: "n-4", title: "蓝图命名约定", summary: "动词前缀 + 对象名 + 变体后缀，避免中文命名", time: "10-24", kind: "note", group: "最近" },
  { id: "n-5", title: "渲染采样对比", summary: "16 与 8 采样在远景观测下的差异记录", time: "10-21", kind: "table", group: "最近" },
  { id: "n-6", title: "地形层材质", summary: "四层混合上限与虚拟纹理的取舍", time: "10-18", kind: "note", group: "更早" },
  { id: "n-7", title: "后处理栈顺序", summary: "Bloom 与色调映射的先后，决定高光溢出形态", time: "10-16", kind: "locked", group: "更早" },
  { id: "n-8", title: "动画蓝图接口", summary: "状态机与蒙太奇的边界划分", time: "10-14", kind: "note", group: "更早" },
  { id: "n-9", title: "性能预算表", summary: "每帧 16.6ms 的拆账，按镜头类型分档", time: "10-11", kind: "table", group: "更早" },
  { id: "n-10", title: "世界分区设置", summary: "Cell 尺寸与流送距离的联动", time: "10-08", kind: "note", group: "更早" },
  { id: "n-11", title: "关卡灰盒流程", summary: "从 blockout 到白模验收的四道关", time: "10-06", kind: "note", group: "更早" },
  { id: "n-12", title: "LOD 生成规则", summary: "按屏幕占比分级，而不是按资产类型", time: "10-03", kind: "note", group: "更早" },
];

export const demoNoteGroups = ["最近", "更早"];

export const demoListTitle = { topic: "UE5", count: 12 };

export interface DemoDocument {
  kicker: string;
  title: string;
  crumb: string;
  status: string;
  updated: string;
  tags: string[];
  source: string;
  wordCount: string;
}

export const demoDocument: DemoDocument = {
  kicker: "Note · UE5",
  title: "材质工作流",
  crumb: "游戏美术 › UE5 › 第 1 篇",
  status: "进行中",
  updated: "2026-10-30",
  tags: ["UE5", "材质"],
  source: "figma.com/file/8c2a",
  wordCount: "1,240 字",
};

export const demoEmptyState = {
  draftsTitle: "草稿箱",
  draftsCount: "0 篇",
  listHint: "还没有草稿",
  listDetail: "新建笔记会先落在这里，归类后自动移出。",
  docTitle: "选择一篇，或新建",
  docDetail: "文档区只在选中之后显示内容，不做引导页。",
};
