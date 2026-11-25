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
