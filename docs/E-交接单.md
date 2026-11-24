# E 交接单

## 1. 已交付

| 交付物 | 路径 | 状态 |
| --- | --- | --- |
| 运维服务 | `services/dbops-service/` | 可运行：状态、备份、恢复、对象核对、主备切换、任务持久化、鉴权 401/403 |
| 服务镜像 | `services/dbops-service/Dockerfile` | 已写，未在本环境构建运行 |
| 单元测试 | `services/dbops-service/tests/test_dbops.py` | **23 项通过** |
| HTTP 冒烟 | `services/dbops-service/tests/smoke_http.py` | **11/11 通过** |
| 本地编排 | `deploy/local-identity/compose.web.yaml` | 已写，未在 Docker 上运行 |
| 网关 | `deploy/nginx.conf`、`deploy/dev-server.py` | 云主机用 dev-server 在 18090 真实跑通 |
| 网页 | `web/console-real.js`、`web/src/services/api.js`、`ConsoleView.js`、`SiteHeader.js` | 主备、备份两页接真实接口；已截图 |
| 演示脚本 | `deploy/scripts/*.ps1` | 5 个脚本语法解析通过 |
| 主备编排 | `deploy/opengauss-ha/` | 编排脚手架；Docker 未实跑 |
| 文档 | `docs/E-*.md`、`docs/e-evidence/` | 已按真实结果回填 |

## 2. 已经真实验证的能力

- 备份：`gs_dump -F c` 两次真实成功，任务 `OP20261123-195445-6191`、`OP20261123-201033-216b`；
- 恢复：`gs_restore` 到 `library_verify_api`、`library_verify_ha`、`library_verify_ha2`，对象核对 8/8；
- 改书名后恢复：源库显示改动值，验证库回到备份时原值；
- 一主一备：node-a（15432）备 / node-b（15443）主，`Streaming`、`sync_percent=100%`；
- 计划内切换：API 任务 `OP20261123-201017-abb7`，`gs_ctl switchover` 5,319 ms，端到端 7.7 秒；
- 切换后写入：新主 `loan_id=900002` 借书成功，备库立即可读；
- 网页：ops1 登录后能看到真实主备状态、备份列表和任务详情（截图在 `docs/e-evidence/`）；
- 鉴权：无令牌 401，`reader01` 提交备份 403，任务记录落在 `/home/user/dbops-tasks`，不在业务库。

## 3. 必须由团队补做的四项

| 对象 | 需要做什么 | 验收标准 |
| --- | --- | --- |
| D | 在 `library_verify_ha2` 上复核 `15-对象核对清单.sql`，在 `docs/e-evidence/05-d-checklist-signoff.md` 签字 | 8 项 + 人工基线一致，签字栏填写完整 |
| C | 把 loan-service（或网页后端）指向 `library_verify_ha2`，用读者账号借一本、还一本 | 网页/服务层产生借阅记录，不是数据库过程层代跑 |
| A/B | 合并 `dbops-service`、确认 `/api/ops/` 路由与网页字段 | 总 compose 启动后 18085 可达，页面无 404 |
| E/全组 | 找一台有 Docker 的机器跑 `deploy/local-identity` + `deploy/opengauss-ha` | `docker compose ps` 六容器 Up；双容器主备 healthy |

## 4. 运行入口

### 4.1 云主机当前已在跑（原生 openGauss）

```text
dbops-service   http://127.0.0.1:18085   OPS_EXEC_MODE=local
身份桩          http://127.0.0.1:18088   ops1/analyst01，密码 123456789000
网页 dev-server http://127.0.0.1:18090
openGauss       node-a 15432（备）/ node-b 15443（主）
```

浏览器打开 `http://<云主机>:18090` 需要安全组放行 18090；课堂演示建议只在本机/跳板机访问，不要直接暴露数据库端口。

### 4.2 Docker 机器（尚未实跑）

```powershell
cd deploy\local-identity
Copy-Item .env.example .env
# 填 OPS_DB_PASSWORD、LIBRARY_LOCAL_PASSWORD、OPS_DB_CONTAINER
docker compose -f compose.yaml -f compose.web.yaml up -d --build
```

主备演示见 `deploy/opengauss-ha/README.md`；单机双容器时注意本机 15432 已被 D 的单实例占用，备节点 SQL 端口不能再用 15433（主节点的 HA 端口默认是 SQL 端口 +1），改用 15443。

## 5. 代码改动要点

- `dbops/executor.py`：local 模式按节点数据目录映射 15432/15443；`gs_ctl -D` 使用传入的 datadir；docker 模式仍走容器内 5432。
- `dbops/status.py`：local 模式用 `gs_ctl query` 判断两个节点；复制延迟用备库 WAL receiver 的 sent/replay LSN 是否相等，避免空闲库误报几百秒。
- `dbops/operations.py`：`_primary_container()` 在 local/docker 都跟随当前主；切换轮询改用 `pg_is_in_recovery()`，结果里的 `newPrimary/newStandby` 按真实角色返回。
- `tests/test_dbops.py`：新增 local 端口映射、local `gs_ctl` datadir 测试。

## 6. 尚未完成 / 风险

- **Docker 单机六容器与 Docker 双容器 HA 未实跑**：本机无 Docker，云主机无 `CAP_SYS_ADMIN`；现有真实证据全部来自原生 openGauss。
- **C 的服务层借还未做**：`06-loan-verify-db.txt` 与 `09-loan-after-switch.txt` 都是数据库过程层预演。
- **D 未签字**：`05-d-checklist-signoff.md` 签字栏为空。
- **VMware 未实跑**：`E-VMware交付说明.md` 只有步骤与检查表。
- 恢复任务的三张表（`loan_record`、`book`、`user`）只打印实际行数，`expected=null`，需要 D 对照备份时基线；不要把“实际行数”当成“期望行数”。
- 网页截图的身份是轻量桩，不是 A 的 identity-service；页面上的运维数据是真实的，登录链路不是正式链路。
- `dbops-service` 在 Docker 模式挂 `docker.sock` 等价 root，只适合课程本机演示。

## 7. 建议提交拆分

```text
E: add dbops-service with status/backup/restore/switchover APIs
E: wire ops routes and console pages
E: add ops scripts and HA scaffolding
E: add deployment, runbook and real test evidence
```

提交前确认 `.env`、`backups/*.dump`、`docs/e-evidence/*.png` 的取舍；截图可以作为课程证据入库，dump 不要入库。
