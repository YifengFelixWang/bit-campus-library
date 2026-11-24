# 运维命令行脚本

这些脚本只调用 dbops-service 的 HTTP 接口，不直接拼 SQL 或 docker 命令。适合在演示前自检，也便于把每一步输出贴进测试报告。

## 前置条件

- `compose.yaml + compose.web.yaml` 已启动，`dbops-service` 健康；
- 浏览器或命令行能访问 `http://127.0.0.1:18085`（或经 Nginx 的 `http://127.0.0.1:8080/api/ops/`）；
- 已创建运维账号 `ops1`（角色 `OPERATOR`）。

## 脚本

| 脚本 | 用途 |
| --- | --- |
| `OpsClient.ps1` | 公共函数：登录、调用接口、轮询任务 |
| `backup-demo.ps1` | 发起一次备份，轮询到结束并打印任务结果 |
| `restore-verify.ps1` | 取最新（或指定）备份，恢复到 `library_verify` 并核对对象 |
| `switchover-demo.ps1` | 计划内主备切换，轮询角色并验证新主可写 |
| `demo-backup-restore.ps1` | 今天的验收链路：备份 → 改演示库书名 → 恢复 → 对比两个库 |

## 示例

```powershell
cd deploy\scripts
.\backup-demo.ps1 -OperatorPassword 123456789000
.\restore-verify.ps1 -OperatorPassword 123456789000
.\demo-backup-restore.ps1 -OperatorPassword 123456789000 -ChangeTitle
.\switchover-demo.ps1 -OperatorPassword 123456789000 -ConfirmSwitch
```

口令只作为参数传入，不写入脚本和仓库。`-BaseUrl` 可指向 Nginx：`http://127.0.0.1:8080`（脚本会把 `/api/ops/...` 拼在 base 上）。
