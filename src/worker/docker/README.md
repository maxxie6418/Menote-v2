# Menote Docker 部署

容器托管 Web 和业务 API，并直接访问 D1 HTTP API 和 R2 S3 API。现有记录、附件键和登录凭据可沿用。应用从 `MENOTE_PUBLIC_ORIGIN` 确定 HTTPS 入口，原有的 Secure Cookie 与同源校验继续生效。

## 本地验证

从仓库根目录构建。Kiri 所用构建器以 `kiri buildx ls` 中指向 Kiri 的条目为准。

```sh
kiri build --builder kiri-build --load -t menote:local -f src/worker/docker/Dockerfile .
```

复制本目录的 `settings.env.example` 为 `.env`，填隔离的 D1 和 R2 资源。已有域名或本地 HTTPS 反代可填写对应域名，仅回环地址支持 HTTP。运行时从同一个镜像入口启动。

```sh
kiri compose -f src/worker/docker/compose.yaml up -d --no-build
```

## 服务器部署

配置文件中的 `AUTH_PEPPER` 必须与现有部署一致，原封不动地从密钥源注入。D1 使用账号限定的写权限 API 令牌，R2 使用限定到原附件桶的对象读写 S3 凭据。所有凭据只在运行时设置，`.env` 已由仓库忽略。

保留现有 HTTPS 域名，配置 HTTPS 反向代理到主机 `127.0.0.1:8787`，把该域名写入 `MENOTE_PUBLIC_ORIGIN`。Compose 只在回环地址发布端口。容器启动会检查绑定和 schema，就绪端点为 `/api/health/ready`。

```sh
docker compose -f src/worker/docker/compose.yaml up -d --build
```

容器首次指向已有实例时，先确认资源与备份，保持 `MENOTE_SCHEDULED_JOBS=false`。完成切流并确认只有一个实例负责调度后，在该实例设为 `true`，启用清理、定时备份和 Raindrop 拉取。切流前确认旧部署中待处理的 AI 任务已完成。需要 AI 时单独设置 `CF_AI_API_TOKEN`，待处理任务保存在该实例的 `state` 卷。发布流程保留该卷。

D1 HTTP API 受 [Cloudflare API 限流](https://developers.cloudflare.com/fundamentals/api/reference/limits/) 约束。上线前用预计的并发量验证同步和登录。涉及新 schema 迁移时，先按已有流程备份并验证兼容性。

## 生产切换前的全量备份与还原

「设置 → 备份」按账号恢复内容。切换部署时还要保留登录凭据哈希、账号角色、历史版本、加密包装及附件，应使用实例级备份。工具把 D1 整库 SQL 和 R2 对象整理为一个 ZIP，每个文件都有 SHA-256。原有 `AUTH_PEPPER` 另从密钥源保存和注入，主密码与明文恢复码由使用者自行持有。ZIP 包含正式内容和凭据哈希，应保存在仓库以外的私人目录。

### 备份到本地

1. 确认需要切换的设备已经完成同步，约定写入暂停窗口。暂停旧入口、剪藏以及调度产生的写入，直到 D1 和 R2 的快照都写完。
2. 用生产 D1 的实际名称或 ID 导出整库 SQL。用 R2 对象读权限，把生产桶完整镜像到空的本地目录。保存 SQL 与对象时沿用真实对象键，备份目录放在仓库外。下面的 `$WORK` 和资源变量由操作者设置。

```sh
pnpm --filter @menote/worker exec wrangler d1 export "$D1_DATABASE" --remote --config "$REPO/wrangler.jsonc" --output "$WORK/database.sql"
AWS_DEFAULT_REGION=auto aws s3 sync "s3://$R2_BUCKET" "$WORK/objects" --endpoint-url "$R2_ENDPOINT"
python "$REPO/src/worker/docker/instance-backup.py" pack --sql "$WORK/database.sql" --objects "$WORK/objects" --output "$WORK/menote-instance.zip"
python "$REPO/src/worker/docker/instance-backup.py" verify "$WORK/menote-instance.zip"
```

D1 导出会在执行期间暂时挡住该数据库的其他查询，大小需要在维护窗口评估。 [D1 导出与导入](https://developers.cloudflare.com/d1/best-practices/import-export-data/) · [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/)

### 恢复演练和正式切换

1. 在隔离账号或同账号的隔离资源中创建空 D1 和空 R2 桶。解包会校验文件清单、大小和哈希。导入工具应明确指向新资源。

```sh
python "$REPO/src/worker/docker/instance-backup.py" unpack "$WORK/menote-instance.zip" "$WORK/restored"
pnpm --filter @menote/worker exec wrangler d1 execute "$RESTORE_D1" --remote --config "$REPO/wrangler.jsonc" --file "$WORK/restored/database.sql"
AWS_DEFAULT_REGION=auto aws s3 sync "$WORK/restored/objects" "s3://$RESTORE_R2" --endpoint-url "$R2_ENDPOINT"
```

2. 验证 D1 表和账号数量，按账号检查 Memo、Note、回收站和历史版本，抽样比对附件字节。用原有效账号和原 `AUTH_PEPPER` 登录，抽查加密笔记和恢复码包装能在客户端正常解锁。隔离演练使用受控入口。
3. 正式 Docker 配置仍然绑定原生产 D1、R2 和原 `AUTH_PEPPER`。先从受控入口验证就绪及既有账号，再协调 Workers Builds 和正式域名入口。用同一个 HTTPS 域名切流以延续浏览器本地库。旧部署保留至正式域名上的登录、笔记和附件核验完成，切流异常时恢复旧入口。
4. 完成切换后只启用一个调度入口。新写入继续落在同一对生产资源，回切时也能读取这些写入。若要从 ZIP 灾难恢复，在新资源验收后再切绑定，避免直接覆盖线上对象。
