# E 交付说明：运维与部署

## 1. 这份交付包含什么

| 部分 | 位置 | 状态 |
| --- | --- | --- |
| 运维服务 `dbops-service` | `services/dbops-service/` | 代码与接口完成；已在云主机原生 openGauss 上真实运行 |
| 网页接入（状态 / 备份 / 恢复 / 切换） | `web/console-real.js`、`web/src/services/api.js`、`ConsoleView.js`、`SiteHeader.js` | 已接真实接口；已用无头浏览器截真实页面 |
| 网关路由 | `deploy/nginx.conf`、`deploy/dev-server.py` | `/api/ops/` 排在 `/api/` 之前；dev-server 已在 18090 跑通 |
| 本地 Docker 编排 | `deploy/local-identity/compose.web.yaml`、`.env.example` | 已加入 `dbops-service`；本环境无 Docker，未启动 |
| 命令行演示 | `deploy/scripts/*.ps1` | 5 个脚本语法解析通过；未连真实库 |
| 主备编排 | `deploy/opengauss-ha/` | Docker 双容器脚手架，未实跑；**原生双实例已真实跑通** |
| 文档与证据 | `docs/E-*.md`、`docs/e-evidence/` | 已回填真实结果与截图 |

## 2. 两条运行路线

### 2.1 Docker 路线（待有 Docker 的机器）

```powershell
cd deploy\local-identity
Copy-Item .env.example .env
notepad .env      # 填数据库口令、OPS_DB_PASSWORD、OPS_DB_CONTAINER
docker compose -f compose.yaml -f compose.web.yaml up -d --build
docker compose -f compose.yaml -f compose.web.yaml ps
start http://127.0.0.1:8080
```

账号：`ops1` / `123456789000`（运维），`analyst01` / `123456789000`（只读测试）。

按课程目录 `分析结果/内部材料/E-今天的验收步骤.md` 走（仅组内）：备份 → 改书名 → 恢复 → D 核对 → C 借还 → 主备切换。

> 本机与云主机都没有可用的 Docker 运行时（本机未安装，云主机缺 `CAP_SYS_ADMIN`），因此这条路线的 `docker compose ps` 截图尚未产生。

### 2.2 云主机原生 openGauss 路线（本次已实际跑通）

```bash
# openGauss-Lite 7.0.0-RC3 已安装在 /home/user/og
export GAUSSHOME=/home/user/og/app
export GAUSSLOG=/home/user/og/log
export PATH=$GAUSSHOME/bin:$PATH
export LD_LIBRARY_PATH=$GAUSSHOME/lib:/home/user/og/dependency

# 当前拓扑：node-a 15432（备）/ node-b 15443（主）
gs_ctl query -D /home/user/og/data
gs_ctl query -D /home/user/og/data-b

# dbops-service（local 模式，真实 HTTP 接口）
cd /home/user/repo/dbops-service
OPS_EXEC_MODE=local \
OPS_DB_CONTAINER=/home/user/og/data \
OPS_STANDBY_CONTAINER=/home/user/og/data-b \
OPS_DB_HOST=127.0.0.1 OPS_DB_PORT=15443 \
OPS_NODE_A_PORT=15432 OPS_NODE_B_PORT=15443 \
OPS_DB_USER=gaussdb OPS_DB_PASSWORD='Gauss@2026Demo' \
OPS_BACKUP_DIR=/home/user/backups OPS_TASK_DIR=/home/user/dbops-tasks \
IDENTITY_URL=http://127.0.0.1:18088 DBOPS_PORT=18085 \
python3 server.py
```

网页：`deploy/dev-server.py 18090`，浏览器访问 `http://<云主机>:18090`（安全组放行 18090，数据库端口不要暴露公网）。

真实结果：备份任务 `OP20261123-201033-216b`、恢复任务 `OP20261123-201832-c5fc`（8/8 核对）、切换任务 `OP20261123-201017-abb7`（7.7 秒）、切换后借书 `loan_id=900002`。详见 `docs/E-测试报告.md` 与 `docs/e-evidence/README.md`。

## 3. 验收对照（来自 E 的任务单）

| 任务单要求 | 本交付对应实现 | 真实状态 |
| --- | --- | --- |
| 同一镜像启动数据库、导入 D 脚本、网页截图 | `deploy/local-identity` + D 的 `06-重建顺序.md` | Docker 未跑；云主机原生导入 + 网页截图已完成 |
| 从演示库备份、恢复到空库、D 核对 | `gs_dump -F c` + `gs_restore` + 8 项 `objectCheck` + 15 清单 | 备份/恢复/自动核对已通过；**D 人工签字待补** |
| 主备流复制、计划内切换、切换后借书 | 双实例流复制 + `gs_ctl switchover` + 新主写探针 | 已通过（7.7 秒）；C 的服务层借书待补 |
| 状态、备份、恢复、切换、任务记录 | 五组 `/api/ops/*`；任务 JSON 落 `/home/user/dbops-tasks` | 真实 API 已跑通 |
| `ops1` 可用、`reader01` 403 | OPERATOR 角色校验 | 单测/冒烟通过；正式身份服务待联调 |
| 服务停机页面降级、旧任务可查 | `reachable=false` + 任务目录独立 | 逻辑有单测；页面停机截图未做 |
| Docker / 云 / VMware 部署说明 | 三份文档 | 已写；Docker 与 VMware 未实跑 |
| 用户手册、测试报告 | `E-用户手册-运维.md`、`E-测试报告.md` | 已按真实结果回填 |

## 4. 已知风险

- `dbops-service` 在 Docker 模式挂 `/var/run/docker.sock` 等价 root，只适合课程本机演示。
- Docker HA 单机双容器时，主节点 SQL 端口 15432、HA 端口默认 15433，备节点 SQL 不能再占 15433；原生同机测试实际用 15443。
- 切换后业务 JDBC 必须用双地址 + `targetServerType=master`，否则会连到已降备的旧主。
- 网页截图的登录使用轻量身份桩，不是 A 的正式 identity-service；页面上的主备/备份/任务数据是真实的。
- D 的人工核对、C 的服务层借还、Docker 部署、VMware 实跑是四项未闭环内容，答辩时按“待办”说明。
