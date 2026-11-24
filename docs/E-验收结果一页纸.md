# E 验收结果一页纸

日期：2026-11-23　执行人：E（ops1）　环境：云主机 `vm` + 原生 openGauss-Lite 7.0.0-RC3

## 一句话结论

**E 的代码、网页接线、备份/恢复、对象核对、主备复制与计划内切换已在真实 openGauss 上跑通；Docker 部署、C 的服务层借还、D 的人工签字、VMware 实跑四项仍需团队补做。**

## 状态板

| 项目 | 状态 | 证据 |
| --- | --- | --- |
| dbops-service 五组接口 | ✅ 真实运行 | 18085；`/api/ops/health/status/backups/restores/switchover/tasks` |
| 网页状态/备份/恢复/切换页 | ✅ 真实截图 | `e-evidence/01-console-home.png`、`07-ha-status.png` |
| 鉴权：无令牌 401 / reader 403 | ✅ | `10-auth-and-task-files.txt` |
| 任务记录在业务库之外 | ✅ | `/home/user/dbops-tasks` 与 `/home/user/og/data` 分离 |
| 备份 `gs_dump -F c` | ✅ 两次 | 任务 `OP20261123-195445-6191`、`OP20261123-201033-216b` |
| 恢复 `gs_restore` | ✅ 三次 | `library_verify_api`、`library_verify_ha`、`library_verify_ha2` |
| 8 项对象核对 | ✅ 自动核对 8/8 | `04-restore-objectcheck.png`、`restore-ha2-task.json` |
| 改书名后恢复对比 | ✅ | 源库「红楼梦【验收改动】」/ 验证库「红楼梦」；HA 阶段「围城【HA后改动】」/「围城」 |
| 一主一备流复制 | ✅ | node-a 备 15432 / node-b 主 15443，`Streaming`、`100%`、延迟 0 秒 |
| 计划内切换 | ✅ 7.7 秒 | `OP20261123-201017-abb7`，命令 5,319 ms，新主可写 |
| 切换后借书 | ✅ 数据库层 | `loan_id=900002`，新主写、备库读 |
| Docker 六容器 / Docker HA | ❌ 未跑 | 本机无 Docker；云主机无 `CAP_SYS_ADMIN` |
| C 的 Java 服务层借还 | ⚠️ 未做 | 只有 E 的数据库过程层预演 |
| D 人工核对签字 | ⚠️ 待签 | `05-d-checklist-signoff.md` 签字栏为空 |
| VMware 实跑 | ⚠️ 未跑 | 仅有交付步骤 |

## 关键数字

- 单测：**23 项通过**；HTTP 冒烟：**11/11**；JS 4 文件与 PowerShell 5 脚本语法检查通过。
- 备份：54,744 字节，SHA-256 `d43460ce5ea64f005d25b19c9ba600d824ad8a17a798d441334bb7f7eb1253b7`。
- 恢复：`OP20261123-201832-c5fc`，`gs_restore` 1,458 ms，8/8 核对。
- 切换：`OP20261123-201017-abb7`，5,319 ms 命令 / 7.7 秒端到端。
- 切换后写：`loan_id=900002`，`user_id=2`，`copy_id=4`，`BORROWED`。

## 答辩演示顺序（10 分钟）

1. 打开网页主备服务器页，展示 node-b 主 / node-a 备、复制延迟 0 秒；
2. 打开切换任务 `OP20261123-201017-abb7`，指出 5,319 ms 与 7.7 秒；
3. 打开恢复任务 `OP20261123-201832-c5fc`，展示 8/8 对象核对和清单输出；
4. 打开 `title-compare-ha.txt`，说明源库与验证库书名差异；
5. 展示 `09-loan-after-switch.txt`，说明切换后新主写入、备库已复制；
6. 主动说明三项待办：Docker 截图、C 服务层借还、D 签字，避免被追问时被动。

## 需要团队本周补做的动作

1. **D**：在 `library_verify_ha2` 跑 `15-对象核对清单.sql`，在 `05-d-checklist-signoff.md` 签字；
2. **C**：把 loan-service 指向 `library_verify_ha2`，网页借一本还一本，记录编号；
3. **A/E**：找一台有 Docker 的机器启动 `deploy/local-identity`，补六容器截图与 Docker HA 截图；
4. **E**：在 VMware 上按 `E-VMware交付说明.md` 跑一遍，补 `docker compose ps` 与页面截图。

## 文件索引

- 详细报告：`docs/E-测试报告.md`
- 交接单：`docs/E-交接单.md`
- 运维手册：`docs/E-用户手册-运维.md`
- 证据索引：`docs/e-evidence/README.md`
- D 复核单：`docs/e-evidence/05-d-checklist-signoff.md`
