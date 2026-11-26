# Inkstone 设置页与 EdgeEver 多维表格界面拆解

2026-11-26 · 设计评估 · [上轮功能专项](Menote_产品调研_设置表格导图与推文剪藏_20261126.md)

评估基线为 Inkstone 0.8.0（`f59087f`）、EdgeEver 2.32.0（`980cd2f`）及 Menote 0.4.4。实看两套公开演示的桌面 1440×1000 与手机宽度 390×844。Inkstone 打开九个分类，查看添加备份目标表单与只读 MCP 样例。EdgeEver 打开交付追踪表，切换三套预置视图，查看筛选、排序和表单收集。变更配置和提交公开表单的行为依据源码和测试定义。[Inkstone 演示](https://inkstone-demo.pages.dev/) · [EdgeEver 演示](https://demo.edgeever.org/)

## 1. Inkstone 设置页

### 桌面与手机怎么排

```text
桌面设置弹窗 · 最大 880 × 720
┌──────── 172px ───────┬────────────────── 内容区 ──────────────────┐
│ 设置                  │ 当前页标题                         关闭 × │
│ 外观                  ├──────────────────────────────────────────┤
│ 编辑器                │ 分组标题                                 │
│ 备份                  │ 标签与解释                      开关/按钮 │
│ 同步                  │ 标签与解释                      选项/滑杆 │
│ MCP                   │ ── 下一组 ──                             │
│ 账户                  │ 状态卡、对象清单或样张依任务选用          │
│ 数据                  │                               内容独立滚动│
│ 分享列表              │                                          │
│ 关于                  │                                          │
│                       │                                          │
│ 快捷键                │                                          │
└──────────────────────┴──────────────────────────────────────────┘
```

- **保持与笔记的空间关系。** 设置以居中模态盖在笔记上，背景调暗，关闭后回到原工作区。左栏用纸色或中性色承托导航，约 30px 高一项，统一 14px 线性图标。当前项用浅强调色底和同色图标。快捷键单独落在导航底部。右栏 48px 固定标题，滚动时关闭按钮留在原位。[框架、尺寸与状态](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/SettingsPanel.tsx#L18-L106)
- **行比卡片更常用。** 功能名放左，只有需要解释后果时才加短副文。控件靠右，变化只影响单行高度。开关用于布尔状态，分段选项用于少量互斥值，滑杆同时显示数值，频率和保留期用下拉菜单。普通偏好之间用细线，状态摘要、空态、对象和效果样张才使用显眼的外框。[共用表单行](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/components/form.tsx#L359-L386) · [外观控件](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/AppearanceSettings.tsx#L31-L183)
- **手机页面层级替代左右栏。** 底部「我的」打开账号卡和纵向目录，点击某项进入单页详情，顶栏有返回「我的」。通用弹窗也能在窄屏打开，此时分类变为横向条。两条入口共用内容，常用的「我的」可以一次扫到九个分类。在其详情内，短控件仍可与左侧标签同行。[手机入口](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/shell/MobileAccount.tsx#L12-L34) · [窄屏行样式](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/styles/app.css#L618-L626) · [通用弹窗](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/SettingsPanel.tsx#L58-L105)

### 九个页面，从上到下放了什么

| 分类 | 屏幕内的顺序与控件 | 操作或状态细节 |
| --- | --- | --- |
| **外观** | 界面语言 → 深浅主题 → 强调色 → 暖纸/纯白 → 界面密度。下方「预览排版」放正文衬线、字号、行高、内容宽度，最后是诗文与行内代码样张。对照桌面演示，分段选项、色盘和滑杆都右对齐。 | 偏好即时响应。样张适合看字号、字体、行距和强调样式；样张取消了最大宽度约束，内容宽度需要回到真实笔记对照。[外观](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/AppearanceSettings.tsx#L31-L211) |
| **编辑器** | 先放编辑器字体、字号、行号、工具栏、拼写检查；再分「写作模式」「预览」，底部是自动保存延时和缩进。 | 打字机模式保持当前行居中，专注模式淡化当前段落以外文字。滚动同步、数学、Mermaid、代码折叠和大纲各自开关。代码折叠开启后才显示行数阈值，复杂选项不会一直占位。[编辑器](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/EditorSettings.tsx#L10-L85) |
| **备份** | 顶部四角圆润的状态卡，左侧提示可用目标，右侧「立即备份」；然后是目标区、自动频率/保留份数、最近运行。空目标用虚线大空态，标题右侧和空态中心都能添加。 | 添加打开二级窗，先选 S3/WebDAV，再选服务预设，随后出现各自字段。底部固定动作顺序为「取消／测试连接／保存」。有运行后可展开逐目标查看结果、字节和耗时，保留或清理提示独立于传输结果。[主界面](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/BackupSettings.tsx#L103-L176) · [目标表单](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/BackupSettings.tsx#L313-L441) · [运行明细](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/BackupSettings.tsx#L548-L580) |
| **同步** | 顶部连接状态带最近同步/待写说明和「立即同步」，下方是实时选项及轮询频率。 | 通道可用才显示实时开关。演示里可以看到已连接、尚无写入记录和当前轮询频率。Menote 已有独立同步诊断和日志，更值得学的是顶部状态与直接动作相邻。[同步](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/SyncSettings.tsx#L32-L107) |
| **MCP** | 顶部状态卡和端点 → 权限开关 → API 密钥 → AI 语义索引 → 分客户端配置 → 已授权客户端 → 隐私说明。 | 先判断服务可用，再授权和接入。密钥行展示权限和最后使用，客户端用折叠块收代码与复制动作。公开演示明确标示端点、凭据和索引为样例、真实操作禁用。[MCP](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/McpSettings.tsx#L308-L652) |
| **账户** | 个人资料卡放头像、显示名、用户名和账户角色；下方编辑显示名。登录安全放密码和 TOTP，站长再见到注册开关。 | 修改密码、开关注册等动作走二级流程并提示影响。TOTP 有设置、验证和备用码。演示可见因保险库不可用而禁用 TOTP 的状态。[账户](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/AccountSettings.tsx#L15-L40) · [密码与注册](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/AccountSettings.tsx#L206-L255) · [TOTP](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/TotpSettings.tsx#L90-L173) |
| **数据** | 概览统计 → 附件管理 → 导出 → 导入 → 维护。统计把笔记、文件夹、标签、双链、总字数、历史、附件和回收站分成小块。 | ZIP 与 JSON 各用一行解释有无附件二进制。备份目录恢复和文件导入有各自的文件选择入口。重建索引、清理未引用附件、清空回收站放在最后。[数据](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/DataSettings.tsx#L103-L273) |
| **分享列表** | 说明和按条件出现的搜索框在顶部。记录先展示标题及生效/过期/回收站状态，再列链接、访问数和有效期，底部提供复制、打开、管理、撤销。 | 空列表、无匹配与加载失败分别处理。它像一张小型管理清单，状态与操作都紧贴对应对象。演示确有一条生效中记录。[分享列表](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/SharedNotes.tsx#L117-L163) |
| **关于** | 账号摘要 → 注册与实例状态 → 版本与重新检查 → PWA/离线准备 → 项目版本链接。 | 站长才看到相应部署更新入口。演示里查询更新失败有「重新检查」，离线准备显示进度。[关于](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/AboutSettings.tsx#L69-L136) |

### 哪些布局决策适合 Menote

1. **同一套行布局可以支撑不同页面。** 保留 Menote 的「常用／内容／高级」侧栏分组与子页链接。用相同左标签、右控件、细分隔线统一普通偏好。复杂页面按任务摆内容。备份首屏回答「现在能不能备份」，其次设置目标，最后看运行记录。MCP 优先回答「能否连接、这个 Token 能做什么」，然后展开对应客户端的示例。[Inkstone 表单行](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/components/form.tsx#L359-L386) · [Menote 设置框架](../src/web/src/features/settings/SettingsDialog.tsx)
2. **保留子页状态，比重画侧栏更有实际影响。** Inkstone 同一次打开会保留访问过的子页，隐藏页不可交互。模块加载失败可在本页重试，其余分类可继续用。Menote 当前切页重挂载并滚动归零。优先针对非敏感表单草稿、筛选和滚动建立往返规则，凭据和恢复码随其流程单独管理。[Inkstone 子页测试](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/settings/SettingsPanel.test.ts#L42-L117) · [Menote 子页代码](../src/web/src/features/settings/SettingsDialog.tsx#L55-L110)
3. **手机可以先比较导航任务。** 用 390px 视口让使用者从设置找到低频的备份恢复、附件或 MCP。Inkstone 的纵向目录容易扫全，Menote 横条便于在常用几项间来回。比较相同任务的查找次数、返回路径和标签截断，再决定承载方式。[Inkstone 手机入口](https://github.com/maxxie6418/inkstone/blob/f59087f66e8c524c465eb7a7ec9ab7883057af02/src/client/features/shell/MobileAccount.tsx#L12-L34) · [Menote 窄屏样式](../src/web/src/styles/settings.css#L202-L207)

## 2. EdgeEver 多维表格

### 页面怎么排

```text
桌面工作区
┌────────┬──────────┬─────────────────────────────── 编辑区 ───────────┐
│ 笔记本树│ 笔记清单 │ 表标题 · 记录数 · 保存     刷新 表单 CSV +字段 +记录│
│        │ 表格图标 │ 默认视图  AI与开放生态  含规格附件  + …  筛选  排序 │
│        │ 行列摘要 ├──────────────────── 吸顶字段名 ──────────────────┤
│        │ 标签     │ 文本        单选       复选框    日期    附件    删除│
│        │         │ ……                                               │
│        │         │                      网格独立横向和纵向滚动        │
└────────┴──────────┴───────────────────────────────────────────────────┘
```

| 区域 | 摆放与作用 |
| --- | --- |
| 左侧定位 | 笔记本树选择范围，中间清单照常列笔记。表格清单项用表格图标、记录数、字段数、部分字段名和标签，让人打开前就能认出内容类型。右侧才进入专用网格。[演示资料](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/docs/best-practices.zh-CN.md#L231-L257) |
| 第一条工具栏 | 左边是表格图标、就地可改的标题、记录数和保存状态。右边顺序为刷新、表单收集、导出 CSV、添加字段、添加记录。「添加记录」是唯一深色主按钮。「收集中」显示在表格外层，便于从工作区看到当前发布状态。刷新在编辑单元格、待保存或保存中禁用。[标题和动作](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L869-L877) · [顶栏](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L996-L1098) |
| 第二条工具栏 | 左边排列视图页签，选中用下划线，后接 `+` 和 `…`。点 `+` 新建视图，`…` 改名、复制或删除。右侧「筛选」「排序」显示当前生效规则数。这样可以分清哪个按钮管整张表，哪个按钮管正在看的视图。[视图栏](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableViewControls.tsx#L262-L312) |
| 网格 | 表头吸顶，每列单行显示类型图标与列名。默认列宽 160px，附件列 240px，右侧删除列 48px。行之间以细线区分，文本太长会省略，附件会按实际内容拉高这一行。宽表由网格横滚，长表只渲染附近行，并保留有焦点及正在编辑的行。[尺寸](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L102-L116) · [网格](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L1108-L1166) · [虚拟滚动用例](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/tests/e2e/structured-table-virtual-grid.spec.ts#L7-L79) |
| 手机宽度 | Web 390px 下只显示当前表和返回清单。整表动作会换到第二行，页签条、筛选和排序仍在表头上方，表横滚。长表名在按钮多时会明显截短，多个视图还会被挤进很窄的横滚区。原生手机端另有只读表示。[Web 布局](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L996-L1028) · [命名视图的移动降级](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/docs/changes/2026-11-06-issue-787-table-views.zh-CN.md#L14-L22) |

### 字段和记录怎么操作

- **表头菜单。** 点击图标和列名打开就地菜单，顺序是字段名称、字段类型、条件出现的单选候选名单，再到删除字段。候选用逗号分隔输入；名称和候选在失焦时写入草稿，类型切换直接修改数据。字段最多 40 列，最后一列不可删。改类型有值转换，删字段会清理数据和各视图引用，所以这类操作适合在 Menote 明确展示影响范围。[字段菜单](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L129-L204) · [字段变化规则](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/packages/shared/src/table.ts#L492-L529)
- **单元格。** 文本、数字、日期直接进格内控件，Enter 或失焦提交，Esc 退出；复选框单击，单选直接选候选，非空网址把打开外链与编辑分成两个动作。附件格显示文件/缩略图和移除入口，另有添加及上传状态。最右侧每行是删除按钮。固定版最多 2,000 行、每附件格 10 项。Menote 已有矩形粘贴、多行操作和多选标签等成熟录入路径，这些可继续沿用。[单元格](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L401-L557) · [附件](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L218-L327) · [行操作](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L970-L993) · [上限](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/packages/shared/src/table.ts#L10-L59)

### 视图、筛选、排序和表单怎么配

| 操作 | 界面层次及演示结果 |
| --- | --- |
| 切换视图 | 默认视图显示 11 条，按发布日期降序，再按模块分类候选顺序。切到「AI 与开放生态」后仅剩 3 条，显示「筛选 2／排序 1」；条件是模块分类相同且验收通过。切到「含规格附件」后为 4 条，显示「筛选 1／排序 1」。只是换当前查看方式，源表仍是 11 条。上次选择按表留在本机。[预置规则](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/api/src/demo-seed-data.ts#L888-L921) · [视图选择与保存](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L748-L803) |
| 筛选规则 | 弹窗顶部选「满足全部／满足任一」，下方一条规则一行，顺序是**字段 → 运算符 → 值 → 移除**。不同字段切换值控件，文本用输入框、单选用已有候选、日期范围用两个日期框、本周或附件非空没有值框。窄屏把值放到第二行。最多八条，规则未填齐则「应用」禁用。我在演示里添加了一条临时规则并取消，原视图未改。[筛选控件](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableViewControls.tsx#L44-L82) · [筛选面板](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableViewControls.tsx#L151-L207) |
| 多级排序 | 弹窗一行是一组「字段／方向／上移／下移／删除」。方向会随类型变化，优先级取列表从上到下。字段不能重复使用。底部是添加排序与「取消／应用」。空值最后，同值保原顺序。改变视图排序会改变显示次序和当前视图 CSV，完整 Markdown 仍按原表导出。[排序面板](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableViewControls.tsx#L206-L259) · [排序规则与导出](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/docs/changes/2026-11-06-issue-787-table-views.zh-CN.md#L7-L16) |
| 表单收集 | 点第一栏进入独立窄弹窗。顶部先放「接受填写」开关、可复制链接和访问密码。中部是标题、说明与提交按钮文案。下方每个字段一行，**左勾选是否开放，右勾选是否必填**，未开放时禁用必填。公开填写页只给字段和提交，成功则展示结果。可写入原表中不满足当前筛选的记录。实际分享和写入需要分别验收权限及回执。[表主设置](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/dialogs/TableFormDialog.tsx#L297-L426) · [填表端](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/PublicTableFormPage.tsx#L93-L189) · [项目截图](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/docs/best-practices.zh-CN.md#L248-L257) |

### 哪些布局决策适合 Menote

1. **参考两个操作层级。** 第一行固定承载标题、保存和整表动作，第二行承载查看方式和当前规则数。Menote 的添加字段、行详情与批量动作继续靠近网格。对于只有一套默认视图的表，第二行可保持紧凑。
2. **先定义查看与写入的区别。** 给长期维护的收藏表提供「保存当前筛选为视图」。第一轮用标签、状态、日期和附件筛选。Menote 当前排序承诺直接重排 Markdown，命名视图新增「视图内排序」，仍可明确执行「重排原表」。导出入口标出当前视图或全表，Raindrop 同步继续针对原表。实施前需要确认新视图的保存、同步和字段变更规则。[Menote 现行规范](Menote_V2_需求说明书_v1.64.md#L191-L207) · [Menote 当前网格](../src/web/src/features/table/TableDocument.tsx)
3. **窄屏给内容留位置。** 围绕 390px 下找视图、定位一行、打开详情三项任务验收。标题显示完整可理解的名称，保留可见的活动视图和添加记录。低频整表动作可以从更多菜单进入。EdgeEver 的双层划分清晰，直接把所有桌面动作留在窄屏会压缩标题和视图区域。[EdgeEver 窄屏实现](https://github.com/maxxie6418/edgeever/blob/980cd2fceec7afffdd40f5aabf388a873f69b8c8/apps/web/src/components/TableEditorPane.tsx#L996-L1028)
4. **公开表单独立评审。** 如果有外部收集需求，可复用仅追加、显式开放字段和必填规则。它需要匿名写权限、附件归属和可重试提交回执。命名视图与 CSV 已经能服务现有个人整理流程。
