# openGauss 一主一备（Docker 单机演示）

同一台机器上启动两个 openGauss 容器：

- `library-opengauss-a`：主节点，映射 `127.0.0.1:15432`；
- `library-opengauss-b`：备节点，映射 `127.0.0.1:15433`；
- 两个容器在同一 Docker 网络 `campus-library-ha`，复制端口 5433/5434；
- 数据落在命名卷 `db-a-data` / `db-b-data`。

## 适用边界

这是课程演示配置，不是生产高可用方案：没有仲裁、没有自动 failover、没有备份保留策略，`pg_hba.conf` 使用 `trust`。生产环境应使用 OM/CM 或云数据库的主备能力。

## 前置条件

1. Docker Desktop 已启动，分配内存建议 ≥ 6 GB（两个 openGauss-lite 实例）。
2. 已停止占用 15432 的旧容器（D 的单实例演示库）：
   ```powershell
   docker stop library-opengauss
   ```
3. 仓库根目录有 `database/opengauss/dist/library.sql` 和 `init_roles.py`（D 的交付物）。

## 启动

```powershell
cd deploy\opengauss-ha
Copy-Item .env.example .env
# 编辑 .env：OPENGAUSS_IMAGE 用 D 锁定的标签，GS_PASSWORD 写本机演示口令
docker compose up -d --build
docker compose ps
docker logs -f library-opengauss-b
```

首次启动会做三件事：`gs_initdb` 初始化、主节点以 `-M primary` 启动、备节点执行 `gs_ctl build -b full` 全量复制。`db-b` 的健康检查通过后才算就绪。

## 导入业务库

主节点起来后，按 D 的 `database/opengauss/06-重建顺序.md` 在 `localhost:15432` 上创建 `library` 库、业务角色并导入 `dist/library.sql`。导入产生的 WAL 会自动同步到备节点。

> 注意：如果先导入再启动备节点，`gs_ctl build` 会基于当前主节点数据做全量复制，同样能拿到完整数据。

## 接入业务与运维

在 `deploy/local-identity/.env` 中改成主备地址（两个节点都写进 JDBC URL，驱动用 `targetServerType=master` 自动找主）：

```dotenv
LIBRARY_JDBC_URL=jdbc:opengauss://host.docker.internal:15432,host.docker.internal:15433/library?targetServerType=master&connectTimeout=10&socketTimeout=30
OPS_DB_CONTAINER=library-opengauss-a
OPS_STANDBY_CONTAINER=library-opengauss-b
OPS_NODE_A_PORT=15432
OPS_NODE_B_PORT=15433
```

然后重启网页栈：

```powershell
cd deploy\local-identity
docker compose -f compose.yaml -f compose.web.yaml up -d
```

`dbops-service` 的状态页会显示 `node-a` / `node-b` 的角色、数据库状态、复制延迟；复制正常时状态为 `STREAMING`。`备份与恢复` 页的备份默认从当前主节点执行，切换后会自动跟随新主。

## 计划内切换

页面：控制台 → 主备服务器 → 切换主备 → 确认切换。

命令行：

```powershell
cd deploy\scripts
.\switchover-demo.ps1 -OperatorPassword 123456789000 -ConfirmSwitch
```

手工执行（等价）：

```bash
docker exec -u omm library-opengauss-b gs_ctl switchover -D /var/lib/opengauss/data -t 120
```

切换后角色互换：`library-opengauss-b` 为主，`library-opengauss-a` 为备。业务侧靠 JDBC 的 `targetServerType=master` 重新寻主，不需要改配置；重新登录后借一本书即可验证写入。

## 回退与清理

```powershell
cd deploy\opengauss-ha
docker compose down          # 保留数据卷，下次还能起来
docker compose down -v       # 删除两个数据卷，回到空库
```

## 常见问题

| 现象 | 排查 |
| --- | --- |
| `db-b` 一直 unhealthy | `docker logs library-opengauss-b` 看 `gs_ctl build` 是否连不上 db-a；确认两容器在同一网络、5432 端口互通 |
| `gs_ctl query` 显示 `Pending` | 主节点还没完成启动，等 1–2 分钟；或看主节点日志 |
| JDBC 报 `Forbid remote connection with trust method` | openGauss 不允许跨节点 trust 远程连接；把应用容器与数据库放在同一 Docker 网络，或给业务角色设密码并改用 `sha256` 认证 |
| 切换后应用仍连旧主 | 确认 JDBC URL 配了 `targetServerType=master` 且两个地址都在 URL 中；连接池要重建连接 |
| 端口 15432 被占用 | 旧的单实例 `library-opengauss` 还在运行，`docker stop library-opengauss` |

## 验证记录（第一次跑时填写）

| 检查项 | 结果 | 证据 |
| --- | --- | --- |
| 两容器 `docker compose ps` 均 healthy | 待实测 | 截图/命令输出 |
| `gs_ctl query` 一主一备，`db_state=Normal` | 待实测 | 两节点输出 |
| 页面显示 node-a / node-b 与复制延迟 | 待实测 | 页面截图 |
| 切换后角色互换 | 待实测 | 任务详情 |
| 切换后业务重新登录并借书成功 | 待实测 | 借阅记录 |
