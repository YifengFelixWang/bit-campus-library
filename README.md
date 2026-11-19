# 校园图书室微服务

读者先登录 A，C 再通过 A 的令牌识别读者，并使用对应的数据库账号连接 D 的 openGauss 开发库。登录页会显示当前数据库连接的 `current_user` 和 `session_user`。

| 负责人 | 共享内容 |
| --- | --- |
| A | [身份服务及读者登录页](services/identity-service)，验证密码、签发令牌、返回读者与角色 |
| C | [借阅服务](services/loan-service) 与 [借还过程及授权](database/loan)，根据读者身份选择连接 |
| D | [openGauss 数据库](database/opengauss/README.md)，含建库说明、角色、表、种子数据和逻辑备份 |

## 第一次在自己电脑上运行

1. 按 [D 的数据库重建说明](database/opengauss/README.md) 准备 `library` 库，或取得组内现有开发库的连接信息。本机默认端口为 `15432`。
2. 使用教学库统一开发口令时，将 `database/opengauss/env.example` 复制成同目录的 `.env`，在其中的 `LIBRARY_LOCAL_PASSWORD` 填入你实际设置的数据库角色密码。如各角色使用不同密码，分别通过环境变量提供，详见 [联调说明](docs/读者登录联调.md)。
3. 准备 Java 21 和 Maven，在工程根目录打开两个 PowerShell 窗口。第一个运行 `.\start-identity.ps1 -InitReaders`，按提示设置两个读者自己的应用密码。第二个运行 `.\start-local.ps1`。数据库里已有读者密码时，启动 A 使用 `.\start-identity.ps1`。
4. 打开 [读者登录页](http://127.0.0.1:8081/)，分别用 `reader01` 和 `reader02` 登录。页面应依次显示 `db_loan_reader01` 和 `db_loan_reader02`。组内验收步骤和两张实测截图见 [联调说明](docs/读者登录联调.md)。

## C 的借还业务与独立测试

执行借还业务前，用初始化账户连接 `library`，依次通过 `gsql -v ON_ERROR_STOP=1 -f 文件路径` 执行 [借还过程](database/loan/002_procedures.sql) 和 [过程授权](database/loan/004_execute_grants.sql)。

C 单独开发时可以在 8081 运行 `python tests/loan/identity_stub.py`，再启动 C，打开 [借阅页面](http://localhost:8083/) 使用替身令牌 `demo-reader-1`、`demo-reader-2`、`demo-librarian`。联调真实 A 时应先退出占用 8081 的替身。借还回归在专用测试库执行 `python tests/loan/acceptance.py`，数据库回归由初始化用户执行 `gsql -v ON_ERROR_STOP=1 -f tests/loan/database_regression.sql`。

## 文档

- docs/C交付说明.md：实现、接口、权限、协作边界。
- docs/D联调交接.md：过程签名、数据约定、报表同步。
- docs/验证记录.md：实际执行结果和待验证事项。

独立 HTML/JS 页面可直接运行；尚未合并 B 的 Vue 工程。D 的原始目录保持不变。


## 构建和测试

在 services/loan-service 执行 `mvn package`。本机 Windows 若出现 `Unable to establish loopback connection`，可用 `mvn "-DargLine=-Djdk.net.unixdomain.tmpdir=C:/Windows/Temp" package`，前提是该目录可写。正式 Linux 环境无需此参数。

依赖固定为 Spring Boot 3.4.13、Java 21、openGauss JDBC 7.0.0-RC3-og（org.opengauss.Driver）。应用所有数据库连接设置 Asia/Shanghai 时区。
