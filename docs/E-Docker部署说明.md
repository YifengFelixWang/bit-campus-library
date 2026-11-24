# Docker 部署说明（本机演示）

目标：在一台装有 Docker Desktop 的 Windows 机器上，把 D 的 openGauss 单实例、四个业务服务、网页和 E 的 `dbops-service` 一起跑起来，页面能完成备份、恢复验证和主备切换（主备另见 `deploy/opengauss-ha/`）。

## 1. 前置检查

```powershell
docker version
docker ps -a --format "{{.Names}}`t{{.Image}}`t{{.Status}}"
```

数据库容器应为 `library-opengauss`，映射 `127.0.0.1:15432 -> 5432`，镜像标签与 D 的 `database/opengauss/00-环境记录.md` 一致。没有就先按 D 的 `06-重建顺序.md` 重建，不要换版本。

## 2. 准备环境变量

```powershell
cd deploy\local-identity
Copy-Item .env.example .env
notepad .env
```

必须填的项：

| 变量 | 含义 | 来源 |
| --- | --- | --- |
| `LIBRARY_JDBC_URL` | 业务库 JDBC | 单实例默认 `jdbc:opengauss://host.docker.internal:15432/library` |
| `IAM_DB_PASSWORD` / `LOAN_DB_*` / `CATALOG_DB_*` / `REPORT_DB_*` | 各业务角色口令 | D 的 `init_roles.py` 创建时的口令 |
| `OPS_DB_PASSWORD` | `gaussdb` 管理员口令，供 `gs_dump/gs_restore/gs_ctl` 使用 | `database/opengauss/.env` 里的 `LIBRARY_LOCAL_PASSWORD` |
| `OPS_DB_CONTAINER` | 数据库容器名 | 默认 `library-opengauss` |
| `OPS_STANDBY_CONTAINER` | 备节点容器名 | 单实例留空；主备演示填 `library-opengauss-b` |

`.env` 已在 `.gitignore` 中，不要提交。

## 3. 启动

```powershell
# 仍在 deploy\local-identity
docker compose -f compose.yaml -f compose.web.yaml up -d --build
docker compose -f compose.yaml -f compose.web.yaml ps
```

首次构建会拉取 `docker:27-cli`、`python:3.12-slim` 和四个 Java 服务的 Maven 依赖，时间取决于网络。

服务清单：

| 服务 | 地址 | 说明 |
| --- | --- | --- |
| web (Nginx) | `http://127.0.0.1:8080` | 唯一对浏览器暴露的入口 |
| identity-service | `127.0.0.1:8081` | 登录与 `/users/me` |
| catalog-service | 内部 8082 | 书目、公告 |
| loan-service | `127.0.0.1:8083` | 借还 |
| report-service | `127.0.0.1:18084` | 报表 |
| dbops-service | `127.0.0.1:18085` | 运维接口，页面经 `/api/ops/` 代理 |

## 4. 验证

```powershell
# 健康检查（不需要令牌）
Invoke-RestMethod http://127.0.0.1:18085/api/ops/health | ConvertTo-Json -Depth 3

# 经 Nginx 的同一接口
Invoke-RestMethod http://127.0.0.1:8080/api/ops/health | ConvertTo-Json -Depth 3

# 登录拿令牌（PowerShell 7）
$login = Invoke-RestMethod -Method Post http://127.0.0.1:8081/auth/login `
  -ContentType "application/json" -Body '{"username":"ops1","password":"123456789000"}'
$token = $login.accessToken
$headers = @{ Authorization = "Bearer $token" }
Invoke-RestMethod http://127.0.0.1:8080/api/ops/status -Headers $headers | ConvertTo-Json -Depth 6
```

期望：`health` 返回 `status=UP`；`status` 的 `database.reachable=true`，单实例时 `replication.state=SINGLE`，`nodes[0].role=primary`。

浏览器：`http://127.0.0.1:8080` → 登录 `ops1` → 控制台 → 主备服务器 / 备份与恢复。

## 5. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `dbops-service` 反复重启 | 看 `docker compose ... logs dbops-service`；常见是 `.env` 没填 `OPS_DB_PASSWORD`，compose 变量插值直接报错 |
| 页面 `/api/ops/health` 返回 502 | Nginx 没加载新配置：`docker compose ... restart web`；或 `dbops-service` 没起来 |
| 状态页 `database.reachable=false` | 容器名不对、数据库没启动、管理员口令错。先 `docker exec -u omm library-opengauss gsql -U gaussdb -W <口令> -p 5432 -d library -c "select 1"` 验证 |
| 备份任务失败 `找不到 docker 客户端` | `dbops-service` 镜像没有 docker CLI，确认 Dockerfile 的 `COPY --from=dockercli` 构建成功 |
| 备份任务失败 `permission denied /var/run/docker.sock` | Docker Desktop 未允许 socket 挂载；在 Settings → General 确认 "Expose daemon on tcp://localhost:2375" 不必开，但本地 socket 必须可挂载。Linux 上把容器用户加入 docker 组或 `chmod 666` 仅限演示 |
| 恢复报“默认不允许覆盖业务库” | 这是设计：目标库必须以 `library_verify` 开头；确实要覆盖业务库才设 `OPS_ALLOW_PRODUCTION_RESTORE=true` |
| 端口 8080/8081/8083/18084/18085 冲突 | 先 `Get-NetTCPConnection -LocalPort 8080` 找占用进程；或改 compose 端口映射 |

## 6. 停止与清理

```powershell
cd deploy\local-identity
docker compose -f compose.yaml -f compose.web.yaml down        # 保留任务与备份卷
docker compose -f compose.yaml -f compose.web.yaml down -v     # 删除 dbops 任务卷（备份在宿主机 backups/ 目录，不受影响）
```

`../../backups` 目录保存 `*.dump` 和同名清单，删除前确认不再需要。任务记录在 `dbops-tasks` 命名卷里，删除后页面历史清空。
