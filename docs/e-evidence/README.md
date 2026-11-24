# E 真实验收证据（云主机原生 openGauss）

日期：2026-11-23
执行人：E（ops1）
环境：云主机 `vm`，Ubuntu 22.04，4C/8G；openGauss-Lite 7.0.0-RC3 原生安装，**不是 Docker**。

> 说明：云主机没有 `CAP_SYS_ADMIN`，dockerd 起不来，Docker 部署无法在本环境执行。下面所有结果都来自原生 openGauss 进程、原生 `gs_dump/gs_restore/gs_ctl` 和真实 dbops-service HTTP 接口；没有 P 图，也没有把“待实测”写成“通过”。
>
> 截图左下角 `library · 未连接` 是网页对 catalog/loan 业务服务的连接指示；本次只启动了 dbops-service 与身份桩，没有启动 A/B/C 的业务服务。运维页里的 `数据库在线`、节点卡片和任务数据才是 dbops-service 读到的 openGauss 状态，不要因为左下角而误判数据库离线。

## 文件清单

| 文件 | 对应验收项 | 说明 |
| --- | --- | --- |
| `01-console-home.png` | 网页接线 | ops1 登录后的管理控制台；身份用轻量桩，状态与任务来自 dbops-service |
| `03-backup-page.png` | 备份页 | 三份真实 dump 与任务列表 |
| `03-backup-task.png` | T2 创建备份 | 任务 `OP20261123-201033-216b`，四步全绿，54,744 字节 |
| `04-restore-objectcheck.png` | T3/T4 恢复与核对 | 任务 `OP20261123-201832-c5fc` 恢复到 `library_verify_ha2`，8/8 通过，含 `15-对象核对清单.sql` 全文 |
| `05-d-checklist-signoff.md` | T4 D 核对 | API 核对结果 + 清单输出；**D 的人工签字栏仍为空，尚未签字** |
| `06-loan-verify-db.txt` | T5 C 借还（预演） | 数据库过程层借还 `loan_id=900001`；**C 的 Java 服务未接入，不能替代正式验收** |
| `07-ha-status.png` | T6 一主一备 | node-a 备 15432 / node-b 主 15443，`Streaming`，复制延迟 0 秒 |
| `08-switchover-task.png` | T7 计划内切换 | 任务 `OP20261123-201017-abb7`，命令 5,319 ms，端到端 7.7 秒，新主可写 |
| `09-loan-after-switch.txt` | T8 切换后借书 | 新主写入 `loan_id=900002`，备库读到同一记录 |
| `10-auth-and-task-files.txt` | 鉴权/任务落盘 | 真实 API：reader 读状态 200、提交备份 403；任务目录与数据库目录分离 |
| `backup-task.json` | T2 | 19:54 首轮备份任务完整 JSON |
| `restore-task.json` | T3 | 19:54 首轮恢复任务完整 JSON |
| `backup-after-switch-task.json` | 切换后写路径 | 切换后由 API 自动跟随新主完成的备份 |
| `restore-ha2-task.json` | T3/T4 | 20:18 恢复任务完整 JSON，含 checklist 输出 |
| `switchover-api-task.json` | T7 | 20:10 成功的切换任务完整 JSON |
| `ha-topology-final.txt` | T6 | `gs_ctl query` 最终主备拓扑 |
| `title-compare.txt` | T3 | 单实例阶段：源库「红楼梦【验收改动】」/ 验证库「红楼梦」 |
| `title-compare-ha.txt` | T3 | HA 阶段：源库「围城【HA后改动】」/ 验证库「围城」 |
| `backup-manifest.json` | T2 | 备份 sidecar，含 SHA-256 |

## 关键数字

- 备份任务：`OP20261123-201033-216b`，`library-20261123-201034-9007.dump`，54,744 字节，SHA-256 `d43460ce5ea64f005d25b19c9ba600d824ad8a17a798d441334bb7f7eb1253b7`
- 恢复任务：`OP20261123-201832-c5fc`，目标 `library_verify_ha2`，`gs_restore` 1,458 ms，8 项核对全通过
- 切换任务：`OP20261123-201017-abb7`，`gs_ctl switchover` 5,319 ms，端到端 7.7 秒，`writable=true`
- 切换后借书：`loan_id=900002`，`user_id=2`，`copy_id=4`，状态 `BORROWED`，备库立即可读

## 尚未完成的真实项

1. Docker 单机六容器、Docker 双容器 HA：本环境无 Docker，只有编排文件与说明，未跑截图。
2. C 的服务层借还：当前只有数据库过程层预演，需 C 把 loan-service 指向验证库后复跑。
3. D 的人工核对签字：`05-d-checklist-signoff.md` 的签字栏为空。
4. VMware 交付：文档已写，未在 VMware 上实跑。
