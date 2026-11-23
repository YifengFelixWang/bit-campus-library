# 在两个应用容器中验证读者身份

这份 Compose 启动 A 的身份服务和 C 的借阅服务。两者都连接 D 已经初始化的开发库 `library`。在 Docker Desktop 上，应用容器通过 `host.docker.internal:15432` 访问宿主机发布的数据库端口。如果 D 在另一台机器，填入从容器可达的数据库地址，并由 D 确认相关数据库账户可以从应用网络连接。

1. 按 [D 的共享数据库说明](../../database/opengauss/README.md) 准备测试库、`iam` 种子和数据库账户。执行借还业务还要按 [工程说明](../../README.md) 补过程和授权。确认 8081、8083 可供应用容器绑定。
2. 在本目录运行 `Copy-Item .env.example .env`（已有 `.env` 时直接编辑）。填入四个数据库登录用户实际使用的口令。D 的本地教学基线为这四个用户设置了同一个开发口令。初次给种子读者设密码时，另填两个不同的应用登录密码，每个至少 12 个字符，最多 256 个字符。首次构建需要 Docker、Compose v2 以及可访问的镜像仓库和 Maven 依赖源。
3. 如果读者的哈希还是 `REPLACE_WITH_HASH`，运行下面的首次启动命令。只有符合约定编号、用户名和占位哈希的行会被更新。如果读者已经设置过密码，直接运行 `docker compose up -d --build` 并用原密码登录。

   ```powershell
   docker compose -f compose.yaml -f compose.seed.yaml config --quiet
   docker compose -f compose.yaml -f compose.seed.yaml up -d --build
   ```

4. 打开 [本地登录页](http://localhost:8081/)，分别以 `reader01` 和 `reader02` 登录。A 把本次登录令牌转发给 C 的 `/api/me`，C 向 A 的 `/users/me` 验证身份，再从各自的数据库连接读取会话用户。

   | 登录账号 | 页面应显示的 current_user | 页面应显示的 session_user |
   | --- | --- | --- |
   | reader01 | db_loan_reader01 | db_loan_reader01 |
   | reader02 | db_loan_reader02 | db_loan_reader02 |

5. 首次设置完成后，移除 `.env` 中的两行 `IAM_SEED_*`，运行 `docker compose up -d --no-deps identity-service` 用基础配置重建 A 容器，再登录即可。下次均使用 `docker compose up -d`。需要停止两个应用容器时运行 `docker compose down`。

若登录失败，运行 `docker compose logs --tail 60 identity-service` 查看 A 能否连库。若登录成功但查询数据库身份失败，再查看 `docker compose logs --tail 60 loan-service`，核对 C 的三个业务账户口令和 `IDENTITY_URL`。借阅服务的 `/api/health` 只报告服务已启动，读者身份以页面查询成功为准。

## 启动含报表的完整书屋

在本目录的 `.env` 补齐 `CATALOG_DB_*` 口令，并把 `db_report_analyst01` 和 `db_report_sync` 的数据库口令分别填入 `REPORT_DB_ANALYST_PASSWORD` 和 `REPORT_DB_SYNC_PASSWORD`。启用借阅变更同步时，在 `REPORT_SYNC_TOKEN` 填入私有的随机令牌（至少 32 个字符），Compose 会将它同时提供给身份服务和报表服务。

首次给 D 的种子应用账号 `analyst01` 设置密码时，在 `.env` 填入 `IAM_SEED_ANALYST01_PASSWORD`（12～256 个字符），执行以下命令。读者也需要初始化时，在命令中追加 `-f compose.seed.yaml` 至 `up` 前。

```powershell
docker compose -f compose.yaml -f compose.web.yaml -f compose.analyst-seed.yaml up -d --build
```

已有分析员密码或首次初始化完成后，用常规配置启动完整书屋。可以从 `.env` 移除应用初始化密码。

```powershell
docker compose -f compose.yaml -f compose.web.yaml up -d --build
```

打开 [书屋](http://localhost:8080/) 并用 `analyst01` 登录，在控制台查看报表查询、借阅统计和 CSV 导出。通过同一入口的 [报表健康检查](http://localhost:8080/api/reports/health) 查看报表服务及其数据库连接状态。使用 `docker compose -f compose.yaml -f compose.web.yaml down` 停止完整书屋。
