# Menote V2 工程结构与组件设计（v0.22）

- **整理日期**：2026-10-31
- **修订记录**：v0.22（2026-11-18，TP19）登记 Obsidian 导入模块（FR-IMP-2）：`features/import/ObsidianImportPanel.tsx`、`lib/obsidianScan.ts`、`lib/obsidianParse.ts`、`services/obsidianImportService.ts`；不新增目录，复用既有 import feature 与服务分层。v0.15（2026-11-05，TP11）目录树按代码现状修订：没有 `stores/`、没有独立 `inbox` feature、没有 `configGuard`、MCP 是平铺的 `services/mcp*.ts` 而不是 `services/mcp/` 子目录；同步引擎在 `src/web/src/services/syncEngine.ts`；另有 `features/perf`。这是现状对齐，不改产品结论。v0.1 初版；v0.2 单文件软上限 400 行调整为 **1000 行左右**（防失控底线而非鼓励大文件——避免过度碎片化）；v0.3 按 TP3 定义 MCP Token 管理、逐 Token 动态权限/最后调用时间、附件工具边界与权限校验；v0.4 明确 TokenManager 位于设置菜单独立「MCP 接入」栏目；v0.5 确认 MCP 地址由当前 origin + `/api/mcp` 构成，可独立复制/恢复，Token 支持事后复显/复制；v0.6 按 TP4 更新 editor 组件清单；v0.7 增加 ClipTemplateManager、模板契约校验及 Worker 模板 D1 / service / route / MCP 工具边界；v0.8 登记网址收藏的 MCP 工具、专用权限及 Note/Table 写入服务；v0.9 明确外观偏好归属账号，并经 `appearanceSettingsService` → IndexedDB settings/outbox → Worker 同步到 D1 `user_settings`；v0.10 按 TP9 登记 Raindrop 连接器模块（Worker routes/services/db 三层 + 独立 D1 表 + R2 快照 + G3 定时任务 + 设置插件开关与 Raindrop 面板 + 收藏标准列「行 ID」列）；v0.11 登记本机同步诊断日志页与 `syncDiagnosticsService` / IndexedDB 有界日志表（FR-SYNC-11）；v0.12 登记表格单选/多选候选颜色与胶囊展示（FR-TBL-11）；v0.13 登记 `workspaceSettingsService`：侧栏宽度与主题树顺序按账号设置写入 IndexedDB settings/outbox，经 Worker 同步到 D1 `user_settings`；树节点内容移动继续由 `contentService` 写入本地库与 outbox；v0.14 登记 `tableViews` 账号设置同步隐藏列偏好，以及表格行详情面板/列显隐控件；v0.16（2026-11-09）登记 `attachmentPolicyService` 账号附件策略同步、`AttachmentPolicySettings`、Worker 上传策略复验，以及 `SidebarSyncControl` 手动同步/阶段进度；表格附件列由 `TableCellEditor` 承载，加密表格禁用明文上传。
- **v0.21（2026-11-17，TP18）**：首页与侧栏布局调整不新增模块——`app/Sidebar.tsx` 侧栏 Memo 快捷输入高度 60→80px，桌面完整侧栏折叠态改由 `data-sidebar="collapsed"` 显式控制图标栏宽度、导航图标、账户入口与展开按钮（不再与独立 `data-rail` 视觉模式混用）；`app/HomePage.tsx` 首页内容上移约 12px、时间只显示时分、用户名完整展示、全局搜索栏加宽至 24rem（检索沿用既有本地搜索服务）。对应 FR-IA-4/5/12，视觉登记见 DESIGN.md v1.14；分层、令牌与单文件上限约束不变。
- **v0.20（2026-11-16，TP17 跟进）**：`appRoutes.toggleGlobalTagSection` 统一处理全局标签导航，重复点击当前标签时清除 Memo/Note 标签筛选并返回各自的默认列表。
- **v0.19（2026-11-16，TP17）**：`contentHooks.useMemoTags` 提供普通 Memo 可见标签；全局标签入口检测到 Memo 标签时通过 `/memos/tag/<tag>` 路由进入筛选时间线，`MemoWorkspace` 与移动端 Memo 页按该标签过滤。普通 Note 标签路由不变。
- **v0.18（2026-11-16，TP17）**：shared `memoTags.ts` 导出 `findMemoTagRanges` 作为正文标签解析的唯一位置口径；MarkdownView 提供可选 `highlightMemoTags` 展示标记，Memo 时间线、引述预览和移动端随记启用，样式归 `styles/memo.css` 的设计令牌规则。不改变 Memo 正文或存储字段。
- **v0.17（2026-11-16，TP16）**：Memo 在既有 `appearanceSettingsService` 账号偏好中登记 `memoAccessGate`；`MemoAccessGate` 经 `privateSpaceService` 验证私人空间密码但不解锁/保存主题密钥。`MarkdownView` 的可选 `onImageClick` 回调由 Memo 时间线使用，应用内预览归 `features/memo/MemoImagePreview`；不新增加密内容类型或数据层链路。
- **文档定位**：M1「工程规范前置落地」的设计成果。预先设计**改起来最贵的层**——仓库结构、模块边界、代码分层、命名、样式 token 层、组件清单与归属；**不做**逐组件的详细交互稿与 props 定义（开发中按需求说明书 FR 条目实现，以「组件清单 + DoD 结构检查」防混乱）。
- **来源**：需求说明书 v1.20（FR/C/NFR）、主文档 v0.18（10.1/10.3/C-5/C-9）、V1 勘查教训（巨型文件、目录散乱）。
- **约定**：`[实施定]` = 实现期可调的具体选型；结构边界本身按本文执行。

## 9. TP12 v3 组件映射增补（2026-11-06）

- 首页仍归 `src/web/src/app/HomePage.tsx`；视图编排留在 `app/`，数据通过 `services/contentHooks` / `contentService` 获取与写入。
- v3 样式映射分为 `src/web/src/styles/inkstand-shell.css`（外壳/导航）、`inkstand-memo.css`（Memo）、`inkstand-pages.css`（首页、Note、表格页面）与 `settings.css`（设置与账户窗口）；token 统一登记于 `tokens.css`，不得在组件增加行内样式。
- Memo 视图由 `features/memo/MemoWorkspace.tsx` 编排；日期统计、侧记栏、图册、时间线、Todo 与互动各归现有 memo 子组件。一级评论通过 shared `MemoComment.parentId` 契约，web service/db、sync Worker db/service、迁移、备份恢复全链路维护。
- 新增 `appearance` 偏好字段用于侧栏完整/书脊、Memo 侧记栏左右、Todo 默认展开与 Memo 入口口令门禁；兼容旧设置并沿既有账号设置同步链路保存。`memoAccessGate` 仅控制前端 Memo 页面展示。
- 组件公共入口约束、UI→services→db 分层、1000 行单文件软上限和 Worker 入口 200 行限制保持不变。

## 1. 仓库结构与目录树

原则（C-9）：**根目录仅保留必要入口；全部代码收拢在唯一入口文件夹 `src/` 下**（pnpm workspaces 指向 `src/*`，monorepo 边界与"单一入口文件夹"两全）；文档目录 wiki/、archive/ 保持现状。

```text
Menote-v2/
├── README.md               # 项目入口
├── AGENTS.md               # 开发纪律（人类与 Agent 共用，M1 DoD 依据）
├── DESIGN.md               # 核心视觉规范
├── package.json            # 根工作区清单
├── pnpm-workspace.yaml     # 工作区指向 src/*
├── wrangler.jsonc          # 根级部署配置（main → src/worker 入口；Static Assets → src/web 产物）
├── wiki/                   # 产品与设计文档（主文档 / 需求说明书 / 本设计稿）
├── archive/                # 历史文档
└── src/                    # ★ 唯一代码入口
    ├── web/                # 前端应用（React + Vite + Tailwind + shadcn/ui）
    │   ├── index.html
    │   ├── vite.config.ts / tailwind 配置
    │   └── src/
    │       ├── main.tsx / App.tsx        # 应用装配（路由、Provider），禁业务逻辑
    │       ├── app/                      # 全局布局壳：侧栏、appRoutes 路径契约与路由出口、布局（列表/网格）
    │       ├── features/                 # ★ 功能模块（边界见第 3 章）
    │       ├── components/ui/            # shadcn/ui 基础控件（生成后进 here，可改造）
    │       ├── components/               # 跨 feature 业务组件（少量，需公共才放）
    │       ├── services/                 # ★ 服务层：UI 唯一数据入口
    │       ├── db/                       # IndexedDB 访问层（schema + repos）
    │       ├── （无 stores/：会话状态在 services，不另建 zustand 副本）
    │       ├── styles/                   # tokens.css（design tokens）+ 全局样式
    │       └── lib/                      # 纯工具函数
    ├── worker/             # Cloudflare Worker API
    │   └── src/
    │       ├── index.ts                 # 仅装配（路由注册 + 中间件挂载），禁业务逻辑
    │       ├── routes/                  # auth / sync / attachments / trash / restore / backup / monitor / raindrop / admin（mcp/admin 为 M4）
    │       ├── services/                # 业务服务（sessions、tokens、sync、mcp、backup、crypto、envelope、snapshot、monitor、raindrop）
    │       ├── jobs/                    # Cron：snapshot / backup-push / cleanup（孤儿、审计）
    │       ├── db/                      # D1 访问层（迁移 SQL 文件 + 查询模块）
    │       └── middleware/              # session / sameOrigin / monitor（无独立 configGuard 文件）
    └── shared/             # 类型与契约（前后端唯一来源）
        └── src/
            ├── types/                  # 实体类型
            ├── contracts/              # API 消息契约（同步、MCP 工具、备份 manifest）
            └── constants/              # 限制常量（分页、大小上限、限速）
```

- 根目录白名单（新增文件一律归位）：`README.md`、`AGENTS.md`、`DESIGN.md`、`package.json`、`pnpm-workspace.yaml`、`wrangler.jsonc`、`pnpm-lock.yaml`、`.gitignore`、`wiki/`、`archive/`、`draft/`、`todo/`、`src/`。
- `[实施定]` wrangler 配置放根级还是 `src/worker/` 内：以 Deploy to Cloudflare 按钮对 monorepo 的实际支持为准，M1 验证后定。

## 2. 工作区与构建

- **pnpm workspaces**：`packages: ["src/*"]`；类型与契约只在 `src/shared` 定义，web/worker 通过工作区依赖引用，禁止复制类型。
- **构建**：web 用 Vite；worker 用 Wrangler 打包；`AUTH_PEPPER` 为唯一部署 Secret（C-4）。
- **Deploy to Cloudflare**：一键导入 → 自动建 D1/R2 → 根级 wrangler 配置装配（FR-DEP-1~7）。
- `[实施定]` 路由框架：**G1 起采用 Hono**（M2 路由数量增长，index.ts 仅装配 + 各 routes 子应用）；D1 访问方式（倾向原生 SQL + 迁移文件目录，V1 模式）。

## 3. 前端架构：分层与数据流

```text
UI 组件（features/*, components/*）
      ↓ 只调用
services/（feature 服务层：内容命令、检索、备份、加密门面）
      ↓ 只调用
db/（本地库访问层：Dexie schema + repos）         stores/（跨组件轻量状态：zustand）
      ↓
IndexedDB（运行时权威副本） ── sync 引擎（outbox/leader/broadcast） ──> Worker API ──> D1/R2
```

规则：

1. UI 组件**禁止**直接访问 IndexedDB/D1/网络——一律经 services；services 返回类型来自 `src/shared`。
2. sync 引擎为独立模块（features/sync 下 `engine/`），延续 V1 模式：outbox 队列、增量拉取、Web Locks 主锁、BroadcastChannel 广播（不带内容）；其余模块只订阅事件。
3. 跨组件状态仅限会话级 UI 状态（当前路由、解锁态、同步状态指示）；**内容数据一律以本地库为源**，不入 store 缓存副本，避免双份真相。
4. 加解密经 `features/encryption` 门面暴露（unlock/reset/recovery），密钥材料不进入 store 与组件。

### 3.1 功能模块清单（features/*）

| 模块 | 职责 | 对应需求 |
| --- | --- | --- |
| `notes` | Note 列表/网格/文档页、移动归类 | FR-IA |
| `tree` | 主题树/分组、私人空间锁定标识、导航 | FR-IA-3/4 |
| `inbox` | 收件箱/草稿箱、整理出箱 | FR-IA-2/9、FR-EXT-2 |
| `editor` | 编辑器宿主与适配器（见 3.2） | FR-EDT |
| `props` | 内联属性区与类型控件 | FR-PROP |
| `table` | 表格结构化编辑与字段类型 | FR-TBL |
| `memo` | 时间线、快速输入、互动卡片/讨论窗口、引述撰写、todo 侧板 | FR-MEMO |
| `encryption` | 解锁/锁定/恢复码/加密门面 | FR-ENC |
| `sync` | 同步引擎与状态指示 | FR-SYNC |
| `versions` | 版本历史、回收站 | FR-VER |
| `search` | 本地检索（M2）、FTS5 客户端（M4） | FR-IA-10 |
| `settings` | 备份目标、令牌管理、账号级外观/样式、工作区偏好与附件策略编辑、凭据复显；外观经 `appearanceSettingsService`、侧栏宽度/目录顺序经 `workspaceSettingsService`、附件策略经 `attachmentPolicyService` → IndexedDB settings/outbox → Worker 同步至 D1 `user_settings` | FR-BAK/FR-MCP/FR-STYLE/FR-IA-14/FR-SYNC-13 |
| `auth` | 认证门、初始化引导（首个 owner）、登录/注册与会话状态（G1） | FR-USR、C-7 |
| `attachments` | 附件管理面板（列表/引用计数/删除；Note 上传与渲染在 notes/editor，表格通过附件类型列上传/下载）（G5） | FR-SYNC-7/8 |
| `backup` | 备份目标管理面板（逐条添加、连接测试、推送调度、远端快照浏览/删除、保留数量）（G9） | FR-BAK-1/2/4/8 |
| `markdown` | MarkdownView 渲染组件（react-markdown+gfm，任务复选框互写、附件 URL 解析）（G5/E2） | FR-STYLE-1、FR-MEMO-3 |
| `monitor` | Resource Monitor：官方 Worker/D1/R2 指标、应用抽样估算、刷新频率与阈值配置（独立边界，见第 5 章） | FR-MON |

跨模块规则：**feature 之间禁止深引用**——只能 import 对方模块的公共入口（`index.ts`）或经 services/stores；违反在 DoD 结构检查中拦截。

### 3.2 编辑器适配器（关键抽象，M2/M3 双形态的地基）

```text
EditorHost（宿主：加载/保存/字数/滚动容器）
   ↳ 实现 EditorAdapter 接口：
      loadMarkdown(md) / getMarkdown() / onSelectionChange / onScroll / destroy()
        ├── MilkdownWysiwygAdapter（M2 末接入，v1.3 提前：@milkdown/kit，E4 PoC 准入通过）
        └── SourceEditorAdapter（源码高级入口，FR-EDT-3；等宽 textarea [实施定]）
```

- 上层（保存链路、附件插入、格式栏、「/」菜单）只面向接口，**更换编辑器零改造上层**（已验证：G7~G8 功能在两种适配器下共用）。
- 源码编辑收进文档栏「更多」菜单（FR-EDT-3），复用同一 SourceEditorAdapter；Milkdown 往返 PoC 证据与等价规范化清单见 `src/web/poc/`。
- 格式栏与「/」菜单只调用 adapter 上的纯数据方法（Markdown 字符串与选区描述），Milkdown 类型不出 `features/editor/`。

### 3.3 组件清单（目录级，一句话职责；详细 props 开发时定）

**app/**：`AppShell`（断点装配与布局状态，M1.2）、`Sidebar`（导航顺序按 FR-IA-4；品牌旁版本号 + 脚部账户菜单，负责人 2026-11-01）、`AccountMenu`（脚部用户名弹出菜单：主题切换/系统状态/设置/退出登录；配套 `lib/theme.ts` 主题模式管理 + index.html 引导脚本，data-theme 驱动深色令牌）、`MainLayout`（列表/网格双布局壳）、`SystemStatusPage`（健康/同步/资源监控，在主界面右侧内容区显示，M2）。
**tree/**：`TopicTree`（仅主题+分组，支持节点拖动排序、分组跨主题移动及笔记拖入目录）、`TreeNode`、`LockBadge`。树顺序与侧栏宽度经 `workspaceSettingsService` 按账号同步；笔记路径通过 `contentService.saveItemMeta` 持久化。
**notes/**：`NoteList`（穿透聚合清单）、`NoteGrid`、`NoteListItem/Card`、`NoteDocumentView`、`OrganizeDialog`（归类出箱）；`NoteEmptyState`（共享空态，M1.2 已实现基础件，`NoteList`/`NoteGrid`/`NoteDocument` 当前为空态骨架）；`BlankFormChooser`（空白种子期形态选择条，FR-TBL-9，TP2）。
**inbox/**：`InboxPage`、`DraftsPage`、`CollectBar`（预留剪藏入口）。
**editor/**：`EditorHost`、`MilkdownWysiwygAdapter`（M2 末已接入）、`TextareaSourceAdapter`（FR-EDT-3，仅从「更多」进入）、`FormatBar`（正文上方常驻格式栏，FR-EDT-4，TP4）、`SlashMenu`（行首 `/` 菜单，与格式栏同内容，FR-EDT-6，TP4）。预览沿用 `markdown/MarkdownView`，不在 editor 内另建。
**props/**：`PropertyPanel`（可折叠）、`PropertyRow`、`PropertyValueControl`（按 8 类型分派）、`PropertyDefEditor`。
**table/**：`TableBlock`（GFM 解析↔结构化编辑）、`TableCellEditor`（类型化单元格控件，表格文档与 Note 内弹窗双轨共用；单选/多选用胶囊并按字段定义颜色；整页表格附件列支持上传和下载）、`FieldTypeMenu`（8 种字段类型菜单）、`TableDocument`（表格主体文档整页网格：列管理、行增删与拖动排序、单元格编辑及候选颜色设置；颜色存入 YAML `fields.<字段>.optionColors`、显示样式使用主题 tokens；字段可从文档标题栏或表格工具条创建，类型菜单 portal 到视口以免被滚动容器裁切）、`TableColumnVisibility`（列显隐设置，只改当前账号视图）、`TableRowDetailsPanel`（行详情侧栏与封面预览）。隐藏列经 `tableViewSettingsService` → IndexedDB settings/outbox → Worker 同步到 D1 `user_settings` 的 `tableViews` 键；列宽继续只保存在本机偏好（FR-TBL-17）。
**memo/**：`MemoWorkspace`、`MemoAccessGate`（前端页面门禁；设置经 `appearanceSettingsService`，口令校验经 `privateSpaceService` 且不解锁空间）、`MemoTimeline`、`MemoCard`（正文/互动栏/引述快照）、`MemoImagePreview`（复用已鉴权附件 URL 的原图预览）、`MemoGallery`、`MemoWorkbar`、`QuickComposer`、`TodoSidePanel`。评论 UI 经 `memoService` 读写，不直连 IndexedDB 或网络。`MarkdownView` 只在调用方提供 `onImageClick` 时把图片变为可键盘激活的预览入口。

- Note 的 `notes/useNoteViewPosition.ts` 连接文档滚动区与编辑器选区，`lib/noteViewPosition.ts` 按账号和条目管理数字位置。普通 Note 使用标签页会话存储，加密 Note 的位置只留在当前页面内存。
- Memo 的 `memo/useMemoCapture.tsx` 统一首页、侧栏、时间线和移动速记的提交、附件与输入法行为。未保存草稿按入口保存在已登录页面的会话状态中，已提交内容通过既有内容服务落库。
**import/**（TP15，FR-IMP-1；TP19，FR-IMP-2）：`FlomoImportPanel`（账户菜单「导入数据」里的 Flomo 面板：选压缩包 → 摘要与预览 → 确认导入 → 进度与结果）。解析在 `lib/flomoParse.ts`（纯函数：zip → 笔记 HTML → Markdown 与图片清单），落库在 `services/flomoImportService.ts`（图片上传 + 批量写 + 去重）；面板只调服务，不直接碰 IndexedDB 或网络。`ObsidianImportPanel`（TP19：拖入/选择整库、文件夹或 .md → 摘要与勾选列表 → 目标选择 → 确认导入）；扫描收敛在 `lib/obsidianScan.ts`（目录句柄/拖拽树/webkitdirectory 三路 → 扫描清单），解析在 `lib/obsidianParse.ts`（纯函数：分类、整库识别、wiki 与标准图片引用三级解析），落库在 `services/obsidianImportService.ts`（图片上传缓存、引用重写、缺图计数、标题+正文哈希去重）。
**encryption/**：`UnlockDialog`（主题级/单篇两形态）、`RecoveryCodeSetup`、`RecoveryCodeView`、`LockIndicator`。
**versions/**：`HistoryPanel`、`VersionDiff`、`RestoreConfirm`、`TrashPage`。
**search/**：本地检索查询在 `services/searchService.ts`。入口是首页与清单顶部搜索框，不另建命令面板（负责人 2026-11-02）。
**auth/**（G1）：`AuthGate`（应用级会话门：探测/引导/登录/放行）、`CredentialsForm`（引导/登录/注册共用表单）。
**settings/**：`SettingsPage`、`SettingsDialog`（左导航包含「同步日志」「MCP 接入」「剪藏模板」与「插件」栏目）、`AttachmentPolicySettings`（账号级单文件上限与允许扩展名设置）、`BackupTargetForm`、`TokenManager`（逐 Token 管理剪藏模板读写与网址收藏写权限）、`ClipTemplateManager`（列表、JSON 编辑/导入、启停和删除；调用 services）、`SyncLogSection`（FR-SYNC-11：本机同步诊断日志查询/复制/导出）、`StyleEditor`（M4）、`CredentialField`（默认脱敏+查看复用，通用件）、`PluginSection`（插件开关，TP9：默认关闭，启用才渲染 `RaindropPanel`——令牌录入/绑定配置/拉取频率/立即拉取/同步记录/快照信息；开关关闭时整块隐藏且不影响应用其余功能）。
**monitor/**：`MonitorPanel`、Cloudflare API 设置与资源卡片、刷新/阈值设置（独立边界；UI 只调用 services）。`services/monitorService.ts` 负责前端 API 与应用抽样汇总，Worker `services/monitorCloudflareService.ts` 查询官方 Analytics GraphQL，Worker `db/monitor.ts` 管理加密凭据配置；Cloudflare Token 以 `AUTH_PEPPER` 派生密钥加密并按 userId 隔离。
**同步诊断**：`services/syncDiagnosticsService.ts` 异步写入本机 IndexedDB `syncDiagnostics` 表，按账号隔离、每账号最多 2,000 条；同步引擎只记结构化阶段/回执字段，UI 经服务读取。不得写入正文、标题、附件名、完整内容哈希或密钥；诊断落库失败不可影响业务流程。
**附件策略与同步状态**：services/attachmentPolicyService.ts 通过账号设置与 outbox 同步扩展名/大小；Worker services/attachmentService.ts 每次上传读取该策略并遵守 20 MiB 硬上限。SidebarSyncControl 读取 syncEngine 的推送队列和拉取阶段，手动同步等待 Web Lock。services/editorSaveService.ts 管理当前标签页按账号注册的编辑保存回调与变更序号（不缓存正文或密钥）；手动同步先调用该出口完成普通/加密编辑保存，再等待内容命令队列与同步锁；contentHooks 的队列订阅同时覆盖本标签页与跨标签页变化。
**ai/**（TP8）：`AiAssistDialog`（摘要预览确认写属性区、标签勾选追加；Note 编辑器「更多」菜单入口，仅 Note）；AI 开关/模型/额度设置节在 `settings/`（`AiSection`）。UI 只经 services 调用。
**components/ui/**（shadcn）：Button / Input / Dialog / DropdownMenu / Popover / Tabs / Tooltip / Toast / Checkbox / Select / Calendar 等，按需生成。另有自研公共件：`AnchoredPanel`、`ContextMenu`、`InfoHint`、`SectionHead`、`ConfirmDialog`（0.2.87：全局确认/输入/提示弹窗，Promise 服务 `confirmDialog/promptDialog/alertDialog` + 根部唯一宿主，替代全部 `window.confirm/alert/prompt` 原生弹窗；破坏性操作用 `danger` 标记并默认焦点落取消）。

## 4. Worker 架构

- `index.ts` 只做装配：`app.route(...)` 注册 + 中间件顺序（session → csrf → configGuard 按路由），**目标单文件 ≤ 200 行**（server.mjs 教训的硬对策）。
- routes ↔ services ↔ db 三层；业务逻辑只在 services；SQL 只在 db 层。
- 备份 Provider 协议操作（WebDAV/S3 写入、测试、列表、删除）集中在 `services/backupRemote.ts`；快照组装与完整性清单由 `services/backupService.ts` 负责。
- 快照只读校验由 `services/backupVerifyService.ts` 负责，检查完成标记、清单、分片和附件；校验通过不代表恢复演练通过。
- FR-ENC-6 账户恢复码登记：Web `services/recoveryCodeService.ts` 验证本机包装及账户校验信封；Worker `routes/recoveryCode.ts` → `services/recoveryCodeService.ts` → `db/recoveryCode.ts`，使用 `account_recovery_codes` 原子登记绑定。共享契约由 `contracts/recoveryCode.ts` 校验，迁移 0039 约束同步包装和兼容重放。快照保存绑定 ID 与密文校验信封。
- FR-ENC-6 恢复码更换与旧码合并：`features/settings/RecoveryCodeSettings.tsx` 收集旧码并确认新码已保存，Web 恢复码服务在浏览器里重新包装原有密钥。恢复码路由的轮换接口使用相同 Worker 分层，按账户修订和现有包装集合原子替换绑定、恢复包装和同步事件。
- FR-ENC-2/5 加密附件：Web `services/sealedAttachmentService.ts` 从笔记内容密钥派生附件密钥，`features/attachments/UnlockedAttachment` 和 Milkdown 图片视图仅在解锁态渲染。共享 `contracts/sealedAttachment.ts` 定义信封格式，Worker 复用附件路由及内容寻址存储。备份按密文哈希存取，ZIP 导出在浏览器解锁后进行。
- FR-ENC-2/5 存量附件转换：`services/encryptionCommandService.ts` 调用 `sealedAttachmentService.ts` 生成密文副本，校验笔记、本机历史及恢复稿的修改状态后，原子更新各处引用与同步队列。历史恢复沿用密文附件校验。
- FR-SYNC-8 附件回收：迁移 0040 建立 `attachment_item_refs` 和 `attachment_object_deletions`。Worker `db/attachments.ts` 管理按账户哈希索引的引用、对象键发布和退役队列，`services/attachmentService.ts` 编排 R2 上传及物理删除。回收站保有引用。定时任务和附件管理页共用 30 天保留条件，备份及恢复按已发布对象键读写。
- 备份目标管理（输入归一、凭据密封/解封、推送编排、恢复导入）拆为 `services/backupTargetService.ts` 与 `services/restoreService.ts`；定时 backup_push 与手动推送共用 `runTargetPushById`（负责人 2026-11-01 确认 routes→db 直连回归三层）。
- 附件编排（上限、服务端哈希重算、R2 写删、引用检查）在 Worker `services/attachmentService.ts`；路由只做鉴权与 HTTP 映射。
- 迁移框架：`db/migrations/0001_*.sql` 起的顺序迁移 + 版本表；可重入（幂等）执行（FR-DEP-4）。
- Cron（jobs/）：snapshot 物化、backup-push 状态机、cleanup（孤儿附件 30 天、审计清理）。
- MCP 模块（services/mcp/）：registry（工具注册）、token auth（每次请求读取最新权限）、permissions/scope（内容读取开关、创建/编辑/回收站/附件权限、用户范围与私人空间/单篇加密谓词）、attachments（受权限约束的上传/读取映射）、audit——独立子目录，不与其他服务交叉引用。MCP 协议发现、鉴权和范围解析可执行必需的内部读取；内容读取关闭时不得暴露既有条目。
- 剪藏模板模块：shared 定义 `ClipTemplateV1` 与纯数据校验；Worker `routes/clipTemplates.ts` → `services/clipTemplateService.ts` → `db/clipTemplates.ts` 管理按 userId 隔离的规则；设置页只处理 Menote 声明式模板 JSON；EdgeEver 源码转换是 Menote-clients 的独立离线 CLI，不进入 Worker/Web 运行时；MCP 模板工具只接触模板数据并使用独立权限；浏览器扩展是 MCP 客户端，不被 Worker/UI 反向依赖。
- Menote-clients 的浏览器扩展仍是独立 MCP 客户端，不进入本仓库构建依赖。其阅读样式采集与净化位于 `capture/sourcePresentation.ts`、`reader/articleStyle.ts`；用户偏好/进度位于 `reader/preferences.ts`，交互增强位于 `reader/enhancements.ts`；本地转存结果由 `queue/outbox.ts` 管理，记录展示位于 `history/`，弹窗结果卡位于 `popup/transferStatus.ts`。这些本机元数据不进入 Menote 服务端契约。
- MCP 网址收藏：`routes/mcp.ts` 在 `bookmark:write` 已授权时注册 `append_bookmark`；`services/mcpBookmarkService.ts` 只读取用户指定且在 Token 范围内的明文 Note/Table，`services/mcpBookmarkFormat.ts` 负责追加收藏行/记录；`db/mcpBookmarks.ts` 执行用户归属、加密与范围过滤。仅返回目标 ID 和操作回执，不依赖内容读取权限；写入经同步服务维护 rev、日志和幂等。
- Monitor 模块：`services/monitor/` 采集归一化 + 额度配置；数据写独立表，**不与业务表耦合**（FR-MON-1 复用边界）。
- AI 模块（FR-AI-2，TP8）：shared `contracts/ai.ts` 契约单源；Worker `routes/ai.ts` → `services/aiService.ts` → `db/ai.ts`（`ai_tasks`/`ai_usage_daily` 独立表，不与业务表耦合）；推理经 Workers AI 原生绑定 `AI`，任务队列 `ai-tasks`（生产者/消费者同 Worker，`index.ts` queue 入口 → `dispatchAiQueue` 逐条 ack/retry）；提交链路固定为 开关 → 加密排除（SQL 侧谓词）→ 复用/去重 → 每日预算 → 入队；AI 设置随 `user_settings` 同步（`ai` 键），不经 REST。
- Raindrop 连接器模块（FR-EXT-3，TP9）：shared `contracts/raindrop.ts` 契约单源；Worker `routes/raindrop.ts`（会话鉴权，owner）→ `services/raindropService.ts`（绑定/拉取编排、同步基线与冲突分类）+ `services/raindropApi.ts`（远端 REST 客户端，令牌解密后内存内使用、不落日志）+ `services/raindropTable.ts`（表格行按「行 ID」列的读写，含存量回填）→ `db/raindrop.ts`（`raindrop_bindings` / `raindrop_sync_rows` / `raindrop_sync_runs` 独立表，不与业务表耦合）。定时拉取注册进 G3 `scheduledJobs`（令牌缺失/开关关闭跳过，fail-closed）；远端原始 JSON 快照写 R2 `raindrop/{userId}/` 前缀（内容 hash 复用、保留最近 100 份）；插件收藏标准列由 `mcpBookmarkFormat` 增加「行 ID」列；推送（阶段 B）复用同一账本与基线。
- 官方资源监控：Analytics Token 需 Account Analytics Read；项目筛选标识为 Worker 脚本名、D1 Database ID、R2 Bucket 名称；未配置的资源明确显示需补充标识，不展示账户总量冒充项目数据。

## 5. 数据契约摘要（M1 细化为 `src/shared` 类型与迁移 SQL）

| 实体 | 关键字段（摘要） | 对应需求 |
| --- | --- | --- |
| User | id、username、role(owner/member)、createdAt | FR-USR |
| TopicNode | id、userId、parentId、name、depth(0 主题/1 分组)、isEncSpace | FR-IA |
| Item | id、userId、type(note/table/memo)、topicId、groupId?、title、content(md)、tags[]、status?、source、memoQuote?(sourceMemoId + frozenSnapshot)、rev、metaRev、contentHash、pinned、starred、encSelf、inEncSpace、createdAt/updatedAt/deletedAt | 5.1/5.2、FR-MEMO-8 |
| MemoComment | id、userId、memoId、content(md)、rev、createdAt、updatedAt、deletedAt | FR-MEMO-7；只直接归属 Memo，不含 parentId；Memo 回收站时保留并隐藏，Memo 永久清除时级联清理 |
| Attachment | sha256、userId、size、mime、refCount | FR-SYNC-7/8 |
| ItemVersion | itemId、snapshot、codec、reason、createdAt | FR-VER |
| McpToken | id、userId、tokenPrefix、perms（含可选内容读取/创建/编辑/回收站/附件权限）、scope、includeMemos、allowUrl、ratePerMin、expiresAt、revokedAt、lastUsedAt、**tokenEnc（可逆存储）** | FR-MCP-2/10 |
| McpAudit | id、tokenId、tool、itemId、revBefore/After、result、operationId、at | FR-MCP-6 |
| BackupTarget | id、userId、kind、endpoint、remotePath（默认 menote）、bucket、username、**secretEnc**、retentionCount、lastPushedAt、schedule、enabled、lastResult | FR-BAK |
| MonitorSample | userId、service、metric、value、sampledAt | FR-MON |
| Settings | userId、key、value（含 `tableViews.hiddenColumnsByItem`） | 全局；表格列显隐按账号同步，列宽仍为本机偏好 |

同步消息契约（outbox 操作、`/api/sync` 响应 items/topics/tombstones/settings/nextCursor/hasMore/fullResync、冲突 409 detail）在 M1 以 TypeScript 类型固化于 `src/shared/contracts`，**前端 Worker 共用，禁止各自定义**。

## 6. 样式层（C-5 / FR-STYLE-1）

- `src/web/src/styles/tokens.css`：以 CSS 变量定义 design tokens——`--md-h1-size/color … --md-h6-*`、`--md-code-font/layout`、`--md-body-*`、`--app-bg/fg/accent` 等命名空间（`md-*` 渲染样式 / `app-*` 应用样式）。
- Tailwind 通过 CSS 变量取值；shadcn/ui 主题变量并入同一 tokens 层。
- 组件**禁止**硬编码颜色/字号/间距（DoD 检查项）；FR-STYLE-2 的样式编辑 UI（M4）就是这层变量的可视化编辑器。
- 默认主题一套（简约克制）；多方案保存/切换为 FR-STYLE-3（P2）。

## 7. 命名与文件规范

- 目录/文件：kebab-case；React 组件文件与导出：PascalCase；hooks：`useXxx`；服务：`xxxService.ts`；常量：UPPER_SNAKE。
- 单文件**软上限 1000 行左右**、Worker 入口 ≤ 200 行：软上限是防失控的底线而非鼓励大文件——优先按职责拆分，但**不过度碎片化**，一个内聚的组件/服务可以是完整的大文件；超过软上限必须拆分并说明理由（巨型文件禁令，C-9）。
- 注释与文档语言：中文为主；提交信息用 Conventional Commits（`feat/fix/docs/chore/refactor: 中文描述`）。
- 测试：每里程碑核心路径最小自动化冒烟（Vitest `[实施定]`），位置随被测模块。

## 8. 结构纪律与 DoD

- 每里程碑 DoD（主文档 10.3）+ 结构检查清单：
  1. 根目录白名单核对（新增文件归位）；
  2. 单文件行数抽查（1000/200 上限）；
  3. 跨 feature 深引用检查（只准走公共入口）；
  4. UI 直连数据层检查（必须经 services）；
  5. 样式硬编码检查（必须走 tokens）。
- 检查由 AGENTS.md 约束人工/Agent 自查，M4 起考虑脚本化（lint 规则 `[实施定]`）。

### MCP Agent 工具模块（TP3 前置接入）

- `src/shared/src/contracts/mcpAgent.ts` 定义查询、新建及敏感元数据裁剪的契约。扩展继续使用独立的剪藏、收藏与摘录工具。
- `src/worker/src/routes/mcpAgentTools.ts` 注册工具与校验输入，经 `mcpAgentService.ts` 处理分页、新建和审计。数据库访问集中在 `db/mcpAgent.ts`，查询、附件和收藏共用 `db/mcpPermissions.ts` 的可见性条件。
- Agent 与扩展的新建操作通过 `syncService.ts` 的纯插入路径，同一次批处理写入条目、同步日志和操作记录。收藏写入在更新语句中复核正文与元数据版本及目标可见性。
