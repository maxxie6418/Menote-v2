# Menote V2

Menote V2 是一款通过浏览器使用的本地优先笔记应用，面向个人记录、整理与阅读。它将随手记录的 Memo 与适合长期整理的 Note 放在同一套工作空间中。

项目计划支持离线编辑与多设备同步、Markdown 内容管理、加密笔记和远程备份，并提供 MCP 接口供 AI 工具在授权范围内访问内容。

应用基于 Cloudflare Workers、D1 和 R2 构建，目标是简化自部署，让用户掌握自己的数据。


## M1 本地开发骨架

需要 Node.js 22 与 pnpm 11。运行 `pnpm install --frozen-lockfile` 安装依赖，`pnpm typecheck` 检查类型，`pnpm build` 构建。分别运行 `pnpm dev:web` 和 `pnpm dev:worker` 启动前端与本地 Worker，前端将 `/api` 请求代理到本地 Worker。运行 `pnpm test` 执行本地测试。缺少 `AUTH_PEPPER` 时就绪检查返回不可用。

## 部署入口（开发中）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fmaxxie6418%2FMenote-v2)

该入口使用仓库默认分支；当前远端默认分支为 `dev`，`main` 已按负责人要求建立。此入口目前取默认的 `dev`，只用于隔离测试，不应连接生产 D1/R2；正式环境应单独绑定 `main`。云端一键导入尚未完成验收。Deploy to Cloudflare 会在你的 GitHub 账号中创建仓库副本，并尝试配置资源和构建。

当前开发版已有登录、笔记、同步、加密、备份、MCP 与 Raindrop。健康检查仍公开。正式数据进场门（含附件与加密内容的恢复演练）尚未通过，上线前只使用可丢弃的测试数据。

Cloudflare 构建命令为 `pnpm install --frozen-lockfile && pnpm build`，部署命令为 `pnpm run deploy`。应用唯一必填 Secret 是 `AUTH_PEPPER`：在 Cloudflare Worker 的 Secrets 中安全设置，不要将值提交到仓库或作为公开变量。R2 可能需要在 Cloudflare 账号级先开通；生产部署应跟踪 `main`。预览或测试资源必须与生产 D1/R2 隔离，未验证前不要启用预览环境。仓库配置显式关闭版本 URL；Workers Builds 的分支预览是独立开关，应在 Worker 的 Build → Branch control 中确认关闭，直到完成隔离验证。已部署的旧版本是否启用上述功能，需要在 Cloudflare 控制台单独检查。

`AUTH_PEPPER` 遗失或轮换涉及安全迁移；在兼容轮换方案完成前，不要将重置 Secret 当作普通故障恢复步骤。
