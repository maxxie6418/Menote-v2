# Menote Docker 部署

全新部署默认使用本地 SQLite 和附件目录。Web、业务 API 和定时任务使用同一个 Docker 镜像。`MENOTE_PUBLIC_ORIGIN` 指定对外的 HTTPS 地址。

## 本地验证

从仓库根目录构建镜像。

```sh
docker build -t menote:local -f src/worker/docker/Dockerfile .
```

复制本目录的 `settings.env.example` 为 `.env`，设置随机 `AUTH_PEPPER` 和 `MENOTE_PUBLIC_ORIGIN`。本地验证可使用 `http://127.0.0.1:8787`。Compose 将 SQLite 文件 `menote.sqlite` 和 `objects/` 保存在 `/app/state` 的持久卷中。

```sh
docker compose -f src/worker/docker/compose.yaml up -d --no-build
```

## 服务器部署

使用 Node 24 构建镜像。把随机生成的实例密钥保存在服务器专用的 `.env` 中，由 Compose 的 `env_file` 注入。
`AUTH_PEPPER` 参与校验登录密码、MCP 令牌和解密远端备份等服务凭据。重启、更新或搬移整个实例时继续使用同一值，单独保管。按账号导入 ZIP 时，新实例使用自己的密钥。加密笔记仍使用用户原有的隐私密码或恢复码。

把对外地址写入 `MENOTE_PUBLIC_ORIGIN`，让 HTTPS 反向代理指向 `127.0.0.1:8787`。Compose 将 SQLite 与附件持久化在同一个数据卷。就绪端点为 `/api/health/ready`。

```sh
docker compose -f src/worker/docker/compose.yaml up -d --build
```

单实例启用 `MENOTE_SCHEDULED_JOBS=true` 执行定时备份、清理和 Raindrop 拉取。可选 Workers AI 使用 `CF_ACCOUNT_ID` 和 `CF_AI_API_TOKEN`，任务队列保存在数据卷。主数据库和附件使用本地存储。尚在旧 D1/R2 上的实例先用旧版导出数据，再创建新站并导入；旧工具和操作说明可在版本 `86bfdbb` 查看。

## 账号备份与恢复

进入「设置 → 备份与恢复」。

- **本地备份包**会先同步当前设备的更改，再从服务器生成并校验 ZIP。下载后可在当前站点或新部署的账号选择 ZIP，上传预检、核对数量，再确认合并恢复。支持早期账号迁移包。
- **远程自动备份**支持分别添加 S3 兼容存储和 WebDAV。选每日或每周后，保存目标会启动首份备份；服务每小时检查到期目标，失败时在下一轮重试。手动模式按需推送。可按目标设置保留份数，默认 0 表示不限。只在新快照校验成功后清理超额旧快照。
- 两种备份共用月度分片、附件清单和 SHA-256 校验。包括笔记、回收站、主题、评论、账号设置、加密密钥包装、已存附件、剪藏模板和 Raindrop 行映射。内容合并到已登录的账号，第三方凭据由用户重新配置。账号包不包含服务端账号密码、会话、令牌或笔记版本历史。
- 单个本地 ZIP 的上传上限为 256 MiB，公开域名还受反向代理的请求体上限约束。大包可通过同源的直连部署入口恢复，或使用远程快照。
