# Menote V2 工程结构与组件设计（v0.2）

- **整理日期**：2026-10-31
- **修订记录**：v0.1 初版；v0.2 单文件软上限 400 行调整为 **1000 行左右**（防失控底线而非鼓励大文件——避免过度碎片化）。
- **文档定位**：M1「工程规范前置落地」的设计成果。预先设计**改起来最贵的层**——仓库结构、模块边界、代码分层、命名、样式 token 层、组件清单与归属；**不做**逐组件的详细交互稿与 props 定义（开发中按需求说明书 FR 条目实现，以「组件清单 + DoD 结构检查」防混乱）。
- **来源**：需求说明书 v1.2（FR/C/NFR）、主文档 v0.7（10.1/10.3/C-5/C-9）、V1 勘查教训（巨型文件、目录散乱）。
- **约定**：`[实施定]` = 实现期可调的具体选型；结构边界本身按本文执行。

## 1. 仓库结构与目录树

原则（C-9）：**根目录仅保留必要入口；全部代码收拢在唯一入口文件夹 `src/` 下**（pnpm workspaces 指向 `src/*`，monorepo 边界与"单一入口文件夹"两全）；文档目录 wiki/、archive/ 保持现状。

```text
Menote-v2/
├── README.md               # 项目入口
├── AGENTS.md               # 开发纪律（人类与 Agent 共用，M1 DoD 依据）
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
    │       ├── app/                      # 全局布局壳：侧栏、路由出口、布局（列表/网格）
    │       ├── features/                 # ★ 功能模块（边界见第 3 章）
    │       ├── components/ui/            # shadcn/ui 基础控件（生成后进 here，可改造）
    │       ├── components/               # 跨 feature 业务组件（少量，需公共才放）
    │       ├── services/                 # ★ 服务层：UI 唯一数据入口
    │       ├── db/                       # IndexedDB 访问层（schema + repos）
    │       ├── stores/                   # 跨组件轻量状态（zustand）
    │       ├── styles/                   # tokens.css（design tokens）+ 全局样式
    │       └── lib/                      # 纯工具函数
    ├── worker/             # Cloudflare Worker API
    │   └── src/
    │       ├── index.ts                 # 仅装配（路由注册 + 中间件挂载），禁业务逻辑
    │       ├── routes/                  # auth / sync / attachments / mcp / backup / monitor / admin
    │       ├── services/                # 业务服务（sessions、tokens、sync、mcp、backup、crypto、envelope、snapshot、monitor）
    │       ├── jobs/                    # Cron：snapshot / backup-push / cleanup（孤儿、审计）
    │       ├── db/                      # D1 访问层（迁移 SQL 文件 + 查询模块）
    │       └── middleware/              # session / csrf / configGuard
    └── shared/             # 类型与契约（前后端唯一来源）
        └── src/
            ├── types/                  # 实体类型
            ├── contracts/              # API 消息契约（同步、MCP 工具、备份 manifest）
            └── constants/              # 限制常量（分页、大小上限、限速）
```

- 根目录白名单（新增文件一律归位）：`README.md`、`AGENTS.md`、`package.json`、`pnpm-workspace.yaml`、`wrangler.jsonc`、`pnpm-lock.yaml`、`.gitignore`、`wiki/`、`archive/`、`draft/`、`todo/`、`src/`。
- `[实施定]` wrangler 配置放根级还是 `src/worker/` 内：以 Deploy to Cloudflare 按钮对 monorepo 的实际支持为准，M1 验证后定。

## 2. 工作区与构建

- **pnpm workspaces**：`packages: ["src/*"]`；类型与契约只在 `src/shared` 定义，web/worker 通过工作区依赖引用，禁止复制类型。
- **构建**：web 用 Vite；worker 用 Wrangler 打包；`AUTH_PEPPER` 为唯一部署 Secret（C-4）。
- **Deploy to Cloudflare**：一键导入 → 自动建 D1/R2 → 根级 wrangler 配置装配（FR-DEP-1~7）。
- `[实施定]` 路由框架（倾向 Hono）、D1 访问方式（倾向原生 SQL + 迁移文件目录，V1 模式）。

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
| `memo` | 时间线、快速输入、todo 侧板 | FR-MEMO |
| `encryption` | 解锁/锁定/恢复码/加密门面 | FR-ENC |
| `sync` | 同步引擎与状态指示 | FR-SYNC |
| `versions` | 版本历史、回收站 | FR-VER |
| `search` | 本地检索（M2）、FTS5 客户端（M4） | FR-IA-10 |
| `settings` | 备份目标、令牌管理、样式编辑、凭据复显 | FR-BAK/FR-MCP/FR-STYLE |
| `monitor` | Resource Monitor（独立边界，见第 5 章） | FR-MON |

跨模块规则：**feature 之间禁止深引用**——只能 import 对方模块的公共入口（`index.ts`）或经 services/stores；违反在 DoD 结构检查中拦截。

### 3.2 编辑器适配器（关键抽象，M2/M3 双形态的地基）

```text
EditorHost（宿主：加载/保存/字数/滚动容器）
   ↳ 实现 EditorAdapter 接口：
      loadMarkdown(md) / getMarkdown() / onSelectionChange / onScroll / destroy()
        ├── SourceEditorAdapter（M2：CodeMirror 6 或等宽 textarea + 高亮，[实施定]）
        └── WysiwygAdapter（M3：Typora 式，选型 PoC 决定，往返安全为准入门槛）
```

- 上层（保存链路、附件插入、选中浮条）只面向接口，**M2→M3 切换零改造上层**。
- 源码编辑在 M3 后退居"更多操作"高级入口（FR-EDT-3），复用同一 SourceEditorAdapter。

### 3.3 组件清单（目录级，一句话职责；详细 props 开发时定）

**app/**：`Sidebar`（导航顺序按 FR-IA-4）、`MainLayout`（列表/网格双布局壳）。
**tree/**：`TopicTree`（仅主题+分组）、`TreeNode`、`LockBadge`。
**notes/**：`NoteList`（穿透聚合清单）、`NoteGrid`、`NoteListItem/Card`、`NoteDocumentView`、`OrganizeDialog`（归类出箱）。
**inbox/**：`InboxPage`、`DraftsPage`、`CollectBar`（预留剪藏入口）。
**editor/**：`EditorHost`、`SourceEditor`、`WysiwygEditor`（M3）、`SelectionToolbar`、`MarkdownPreview`、`SourceModeMenuItem`。
**props/**：`PropertyPanel`（可折叠）、`PropertyRow`、`PropertyValueControl`（按 8 类型分派）、`PropertyDefEditor`。
**table/**：`TableBlock`（GFM 解析↔结构化编辑）、`TableCellEditor`、`FieldTypeMenu`。
**memo/**：`Timeline`、`MemoCard`、`QuickComposer`（单行展开）、`TodoSidePanel`、`TodoGroup`。
**encryption/**：`UnlockDialog`（主题级/单篇两形态）、`RecoveryCodeSetup`、`RecoveryCodeView`、`LockIndicator`。
**versions/**：`HistoryPanel`、`VersionDiff`、`RestoreConfirm`、`TrashPage`。
**search/**：`SearchPalette`（本地检索）。
**settings/**：`SettingsPage`、`BackupTargetForm`、`TokenManager`（令牌复显/复制分发）、`StyleEditor`（M4）、`CredentialField`（默认脱敏+查看复用，通用件）。
**monitor/**：`ResourceCards`、`ThresholdSettings`、`UsageTrend`（独立边界：不 import 其他 feature）。
**components/ui/**（shadcn）：Button / Input / Dialog / DropdownMenu / Popover / Tabs / Tooltip / Toast / Checkbox / Select / Calendar 等，按需生成。

## 4. Worker 架构

- `index.ts` 只做装配：`app.route(...)` 注册 + 中间件顺序（session → csrf → configGuard 按路由），**目标单文件 ≤ 200 行**（server.mjs 教训的硬对策）。
- routes ↔ services ↔ db 三层；业务逻辑只在 services；SQL 只在 db 层。
- 迁移框架：`db/migrations/0001_*.sql` 起的顺序迁移 + 版本表；可重入（幂等）执行（FR-DEP-4）。
- Cron（jobs/）：snapshot 物化、backup-push 状态机、cleanup（孤儿附件 30 天、审计清理）。
- MCP 模块（services/mcp/）：registry（工具注册）、scope（可见性谓词，私人空间/单篇加密两层）、audit——独立子目录，不与其他服务交叉引用。
- Monitor 模块：`services/monitor/` 采集归一化 + 额度配置；数据写独立表，**不与业务表耦合**（FR-MON-1 复用边界）。

## 5. 数据契约摘要（M1 细化为 `src/shared` 类型与迁移 SQL）

| 实体 | 关键字段（摘要） | 对应需求 |
| --- | --- | --- |
| User | id、username、role(owner/member)、createdAt | FR-USR |
| TopicNode | id、userId、parentId、name、depth(0 主题/1 分组)、isEncSpace | FR-IA |
| Item | id、userId、type(note/table/memo)、topicId、groupId?、title、content(md)、tags[]、status?、source、rev、metaRev、contentHash、pinned、starred、encSelf、inEncSpace、createdAt/updatedAt/deletedAt | 5.1/5.2 |
| Attachment | sha256、userId、size、mime、refCount | FR-SYNC-7/8 |
| ItemVersion | itemId、snapshot、codec、reason、createdAt | FR-VER |
| McpToken | id、userId、tokenPrefix、perms、scope、includeMemos、allowUrl、ratePerMin、expiresAt、revokedAt、**tokenEnc（可逆存储）** | FR-MCP |
| McpAudit | id、tokenId、tool、itemId、revBefore/After、result、operationId、at | FR-MCP-6 |
| BackupTarget | id、userId、kind、endpoint、bucket、username、**secretEnc**、deletePolicy、schedule、cursorSeq、lastResult | FR-BAK |
| MonitorSample | userId、service、metric、value、sampledAt | FR-MON |
| Settings | userId、key、value | 全局 |

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
