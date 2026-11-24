# E 测试报告

- 日期：2026-11-23
- 执行人：E（部署与运维，账号 `ops1`）
- 代码基线：`1a50aa2` + 本工作区未提交改动
- 结论：**代码级、接口级、数据库备份/恢复、主备复制与计划内切换已在云主机原生 openGauss 上真实通过；Docker 部署、C 的服务层借还、D 的人工签字仍未完成，不能写成“全部通过”。**

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| 开发机 | Windows 10 教育版，`CHINAMI-HUVN9IS`；Python 3.13.18、Node.js v22.23.2、PowerShell 7.6.4；无 Docker、无 openGauss |
| 真实数据库机 | 云主机 `vm`，Ubuntu 22.04，4C/8G；`/home/user` 可用约 10 TB |
| 数据库 | **openGauss-Lite 7.0.0-RC3（build b90edc14）原生安装**，`GAUSSHOME=/home/user/og/app`，非 Docker |
| 实例 | node-a：`/home/user/og/data`，SQL 15432；node-b：`/home/user/og/data-b`，SQL 15443；当前 node-b 主、node-a 备 |
| 运维服务 | `dbops-service` 1.0.0，`OPS_EXEC_MODE=local`，监听 18085；身份桩 18088；网页 18090（dev-server 代理） |
| 数据库账号 | `gaussdb`（SYSADMIN）/ 业务角色，口令仅通过环境变量传入，未写入任务文件 |
| 备份目录 | `/home/user/backups` |
| 任务目录 | `/home/user/dbops-tasks`（业务库之外） |

> 云主机没有 `CAP_SYS_ADMIN`，`dockerd` 起不来，`docker` 部署无法在该机执行。下面的数据库级结果来自原生进程与原生 `gs_dump/gs_restore/gs_ctl`，不是伪造的容器截图。

## 2. 静态检查与单元测试

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Python 编译 | `python -m compileall -q dbops server.py` | 通过 |
| JS 语法（4 个文件） | `node --check console-real.js src/services/api.js src/components/ConsoleView.js src/components/SiteHeader.js` | 通过 |
| PowerShell 语法（5 个脚本） | `Parser::ParseFile` 逐文件解析 | 全部 OK |
| 单元测试 | `python -m unittest discover -s tests` | **Ran 23 tests — OK**（开发机与云主机各复跑一次） |
| HTTP 冒烟 | `python tests/smoke_http.py` | **11/11 通过** |

单元测试新增覆盖：local 模式按节点端口映射、local 模式下 `gs_ctl` 用数据目录作为 `-D`、切换后主节点跟随、本地角色查询不调用 Docker。

HTTP 冒烟仍然覆盖：无令牌 401、`reader01` 写操作 403、`ops1` 备份 202、缺 `confirm` 409、任务失败原因落盘、任务文件落在业务库之外、状态降级不返回 500。

## 3. 数据库级真实验收

### 鉴权与任务落盘 — 真实 API 通过

在云主机 `dbops-service`（18085）上直接请求：

- `analyst01` 的 `reader-token` 读 `/api/ops/status` → HTTP 200，`viewer.username=analyst01`、`roles=[READER]`；
- 同一令牌 `POST /api/ops/backups` → **HTTP 403**，`{"code":"FORBIDDEN","message":"该账号没有运维管理权限"}`；
- `ops1` 的任务 JSON 写在 `/home/user/dbops-tasks`，数据库数据目录是 `/home/user/og/data`，两者分离。

证据：`10-auth-and-task-files.txt`。

### T1 单实例全套 Docker 服务 — 未执行

本机无 Docker，云主机无 `CAP_SYS_ADMIN`，`deploy/local-identity` 的六容器栈没有启动。已做的是原生 openGauss 单实例/双实例 + 本机 dbops-service；Docker 的 `docker compose ps`、容器健康与网页 8080 入口仍待有 Docker 的机器补测。

### T2 创建备份 — 通过

两次真实 API 备份：

| 任务 | 归档 | 大小 | SHA-256 |
| --- | --- | --- | --- |
| `OP20261123-195445-6191` | `library-20261123-195445-934d.dump` | 54,552 B | `5a3702e51ed0bd9cdd824e326520b90c90b0e7022273a444f8168a6025cc5127` |
| `OP20261123-201033-216b` | `library-20261123-201034-9007.dump` | 54,744 B | `d43460ce5ea64f005d25b19c9ba600d824ad8a17a798d441334bb7f7eb1253b7` |

第二次是在切换后发起的，服务自动跟随新主 node-b（15443）完成，证明 local 模式的主节点跟随与端口映射有效。四步全绿：连接检查、`gs_dump -F c`、取回归档、SHA-256 校验与清单登记。

证据：`e-evidence/03-backup-task.png`、`backup-task.json`、`backup-after-switch-task.json`、`backup-manifest.json`。

### T3 改书名后恢复 — 通过

单实例阶段：

- 源库 `catalog.book.book_id=1` 改为「红楼梦【验收改动】」；
- 用备份 `library-20261123-195445-934d.dump` 恢复到 `library_verify_api`；
- 验证库书名回到「红楼梦」，与源库形成明确差异。

HA 阶段：

- 源库 `book_id=3` 改为「围城【HA后改动】」；
- 用备份 `library-20261123-201034-9007.dump` 恢复到 `library_verify_ha2`；
- 验证库书名回到「围城」。

证据：`title-compare.txt`、`title-compare-ha.txt`、`04-restore-objectcheck.png`、`restore-ha2-task.json`。

### T4 对象核对 — API 自动核对通过，D 人工签字待补

恢复任务 `OP20261123-201832-c5fc`（目标 `library_verify_ha2`，`gs_restore` 1,458 ms）的 `objectCheck` 8 项全部 `ok`：

| 项 | 实际 | 期望 |
| --- | --- | --- |
| schemas | 4 | 4 |
| loanIndexes | 2 | 2 |
| reportIndexes | 4 | 4 |
| procedures | 2 | 2 |
| auditTrigger | 1 | 1 |
| loanRecords | 7 | 人工基线 |
| books | 4 | 人工基线 |
| users | 4 | 人工基线 |

`15-对象核对清单.sql` 完整输出已写入任务结果的 `checklistOutput`（2,442 字符），同时保存为 `05-d-checklist-signoff.md`。**该文件的 D 复核签字栏为空，D 尚未签字，因此 T4 只能写“自动核对通过、人工核对待办”，不能写“D 已确认”。**

### T5 验证库借还 — 仅完成数据库过程层预演

以 `db_loan_librarian01` 在 `library_verify_api` 执行：

- `call loan.sp_borrow_copy(1, 2, 7, 'E-VERIFY-BORROW-1', 900001)` → `loan_record` BORROWED；
- `call loan.sp_return_copy(900001, 'E-VERIFY-RETURN-1')` → RETURNED，副本 AVAILABLE；
- `loan_audit` 2 行，request_no 分别为 `E-VERIFY-BORROW-1`、`E-VERIFY-RETURN-1`。

证据：`06-loan-verify-db.txt`。

**限制：C 的 Java `loan-service` 没有指向验证库，也没有在网页发起借还。这是 E 替 C 做的数据库过程层预演，不能替代 C 的服务层验收。**

### T6 一主一备 — 通过

真实 `gs_ctl query` 与 API 状态一致：

- node-a：`/home/user/og/data`，SQL 15432，`local_role=Standby`，`db_state=Normal`；
- node-b：`/home/user/og/data-b`，SQL 15443，`local_role=Primary`；sender `state=Streaming`、`sync_percent=100%`、`sync_state=Sync`；
- dbops-service 状态：`primary=node-b`、`standby=node-a`、`replication.state=STREAMING`、`lagSeconds=0.0`、`database.reachable=true`。

证据：`07-ha-status.png`、`ha-topology-final.txt`。

### T7 计划内切换 — 通过

通过 **HTTP API** 发起，而不是手工跑命令：

- 任务 `OP20261123-201017-abb7`，actor `ops1`；
- `gs_ctl switchover` 命令耗时 **5,319 ms**；
- 端到端（含角色核对与可写验证）**7.7 秒**；
- `before`：`data=primary`、`data-b=standby`；`after`：`data=standby`、`data-b=primary`；
- 新主写入探针成功，`writable=true`。

证据：`08-switchover-task.png`、`switchover-api-task.json`。

> 真实过程中出现过一次失败：local 模式的 `_roles()` 仍调用 `container_running()`，在无 Docker 环境报“找不到 docker 客户端”（任务 `OP20261123-200618-0ca3`）。修复后重跑通过。该失败任务没有被隐藏，测试报告如实记录。

### T8 切换后借书 — 数据库过程层通过，服务层待 C

在新主 node-b（15443）执行 `call loan.sp_borrow_copy(2, 4, 7, 'E-HA-BORROW-1', 900002)`：

- 新主 `loan_record`：`loan_id=900002`、`user_id=2`、`copy_id=4`、`status=BORROWED`；
- 备库 node-a（15432）读取到同一记录；
- `loan_audit` 1 行，request_no `E-HA-BORROW-1`。

证据：`09-loan-after-switch.txt`。

**限制：同样只是数据库过程层，C 的 Java 服务与网页借书仍未验证。**

### T9 停机降级 — 未执行

当前没有在“停掉 dbops-service 后由浏览器显示运维服务不可达”的场景下做截图，状态字段与前端降级逻辑只有单测/冒烟覆盖。

### T10 云主机 / VMware 部署 — 云主机原生部分通过，Docker 与 VMware 未执行

- 云主机原生 openGauss 单实例、主备、备份、恢复、切换均已真实跑通；
- 云主机 Docker 部署未执行（无 `CAP_SYS_ADMIN`）；
- VMware 交付文档已写，未在 VMware 上实跑；
- 网页在云主机用 `dev-server.py` + 无头 Chromium 真实渲染并截图，身份用轻量桩（支持 `ops1` / `analyst01` 登录），不是 A 的正式身份服务；
- 截图左下角 `library · 未连接` 是 catalog/loan 业务服务未启动的提示；运维页的 `数据库在线`、节点卡片与任务数据来自 dbops-service 对 openGauss 的真实查询。

## 4. 已修复的真实缺陷

| 现象 | 根因 | 修复 |
| --- | --- | --- |
| 旧主切换后无法以 standby 启动，日志 `hot standby is not possible because max_locks_per_transaction=64 < 256` | 两节点 `max_locks_per_transaction` / `max_prepared_transactions` 不一致 | 两节点统一为 `max_locks_per_transaction=256`、`max_prepared_transactions=200`，重启后恢复一主一备 |
| local 模式切换任务报“找不到 docker 客户端” | `_roles()` 无条件调用 `container_running()` | 仅 docker 模式检查容器，local 模式直接用 `gs_ctl query` |
| local 模式主备状态把两个节点都查成同一数据目录 | `gs_ctl` 固定使用 `OPS_DB_DATADIR` | local 模式把传入的 `container` 当作该节点 datadir |
| 主备切换后备份仍连旧主/旧端口 | gsql/gs_dump/gs_restore 固定 `OPS_DB_PORT` | local 模式按 data 目录映射 node-a/node-b 端口，切换后自动跟随 |
| 页面显示“复制延迟 385.8 秒” | 用 `now() - pg_last_xact_replay_timestamp()`，空闲库会不断增大；openGauss 也没有 `replay_lag` 列 | 改用备库 `pg_stat_get_wal_receiver()` 的 sent/replay LSN 是否相等；追平显示 0 秒，未追平显示“—” |
| 切换任务显示 156.3 秒 | 轮询用 `gs_ctl query`，备节点重启期间每次等待超时 | 轮询改用 `pg_is_in_recovery()` 快速探测，最终 7.7 秒 |

## 5. 证据清单

全部在 `docs/e-evidence/`，索引见 `README.md`：

- `01-console-home.png`：真实网页控制台；
- `03-backup-page.png`、`03-backup-task.png`：备份列表与任务详情；
- `04-restore-objectcheck.png`：恢复任务 8 项核对 + 清单输出；
- `05-d-checklist-signoff.md`：D 复核单（**待签字**）；
- `06-loan-verify-db.txt`：验证库数据库层借还；
- `07-ha-status.png`：真实主备状态页；
- `08-switchover-task.png`：切换任务详情（7.7 秒）；
- `09-loan-after-switch.txt`：切换后新主借书 + 备库读取；
- `10-auth-and-task-files.txt`：真实 403 与任务目录分离；
- `backup-task.json`、`restore-task.json`、`backup-after-switch-task.json`、`restore-ha2-task.json`、`switchover-api-task.json`：任务原始 JSON；
- `ha-topology-final.txt`：最终 `gs_ctl query` 输出；
- `title-compare.txt`、`title-compare-ha.txt`：恢复前后书名对比。

## 6. 答辩时必须如实说明的边界

1. **Docker 部署没有在本机/云主机跑成功**：本机无 Docker，云主机无 `CAP_SYS_ADMIN`；`deploy/opengauss-ha` 仍是编排脚手架，未产生 Docker 运行截图。
2. **C 的服务层借还没有做**：只有数据库过程层预演，C 需要把 loan-service 指向 `library_verify_ha2` 后复跑。
3. **D 没有人工签字**：`05-d-checklist-signoff.md` 签字栏为空。
4. **VMware 未实跑**：只有交付说明与命令。
5. 网页截图的身份是轻量桩，不是 A 的正式 identity-service；页面上的运维数据、任务、备份都来自真实 dbops-service。

上述四项完成前，E 的交付状态应写“代码与数据库级验收完成，团队联调项待办”，不能写“全部验收通过”。

---

## 6. 2026-11-24 电子书与读者端回归（云端）

| 编号 | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| T-E1 | `GET /api/catalog/books/6/ebook` | 返回 available=true、6.5 MB | 通过 |
| T-E2 | `GET .../ebook/file`（PDF） | 200，`application/pdf`，字节一致 | 200 / 6,807,346 B |
| T-E3 | 同上（EPUB） | 200，`application/epub+zip` | 200 / 72,992,433 B |
| T-E4 | 馆员上传 10.8 MB PDF | 200，落盘并被读者端读到 | 200，6.3 s |
| T-E5 | 非 PDF/EPUB 文件 | 400 `NOT_EBOOK` | 通过 |
| T-E6 | 匿名下载 | 可下载，不需要令牌 | 通过 |
| T-E7 | 读者提交评价 | 有提示、弹窗关闭、列表刷新 | 通过 |
| T-E8 | 我的借阅（含已归还） | 三条记录、状态标签正确 | 通过 |
| T-E9 | 公告发布后读者端 | 立刻可见、日期为当天 | 通过 |

上传回归特意用了超过旧网关上限（8 MB）的文件，确认 `client_max_body_size` 与 multipart 两处都生效。
