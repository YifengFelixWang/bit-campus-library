# 校园图书室微服务

打开 B 的书屋页面可浏览书目。登录由 A 验证密码，B 和 C 向 A 核验同一枚令牌后分别访问 D 的书目库表和借阅库表。

| 负责人 | 共享内容 |
| --- | --- |
| A | [身份服务及读者登录页](services/identity-service)，验证密码、签发令牌、返回读者与角色 |
| B | [Vue 前端](web/) 和 [书目服务](services/catalog-service/)，含多条件检索、书目维护、书评、公告及 CSV 导入导出 |
| C | [借阅服务](services/loan-service) 与 [借还过程及授权](database/loan)，根据读者身份选择连接 |
| D | [openGauss 数据库](database/opengauss/README.md)，含建库说明、角色、表、种子数据和逻辑备份 |

## 运行完整书屋

1. 在 openGauss 中按 [D 的重建说明](database/opengauss/README.md) 准备基础库，再按下表安装 B、C 扩展。已有课程联调库只需要安装尚缺的扩展。本机本次集成已安装扩展和演示书目。
2. 在 `database/opengauss/.env` 填写数据库连接配置，可从同目录 `env.example` 复制。共用开发密码填写 `LIBRARY_LOCAL_PASSWORD`。各角色使用不同密码时分别配置 `IAM_DB_PASSWORD` 和 `CATALOG_DB_`、`LOAN_DB_` 下的 `READER01_PASSWORD`、`READER02_PASSWORD`、`LIBRARIAN01_PASSWORD`。远程库设置 `LIBRARY_JDBC_URL`。
3. 新库首次启动前，在私有配置中为 `IAM_SEED_READER01_PASSWORD`、`IAM_SEED_READER02_PASSWORD` 分别设置 12～256 字符的应用密码。已有读者沿用 A 的原密码。需要测试馆员功能时用相同方式初始化 `IAM_SEED_LIBRARIAN01_PASSWORD`。
4. 安装 Java 21、Python 3 和 Maven。从工程根目录运行 `python scripts/run_library.py`，Windows 可双击 [启动书屋.cmd](启动书屋.cmd)。首次运行会构建三个 Java 服务；修改 Java 源码后运行 `python scripts/run_library.py --build`。看到 `Ready` 后打开 [BIT 书屋](http://127.0.0.1:8080/)。关闭服务用 Ctrl+C。
5. 点「全部图书」，按书名、作者等条件检索。登录后点右上角用户名，在账号菜单中查看借阅数据库身份。网页通过同源代理访问服务；本机完整启动使用身份 18081、书目 8082、借阅 18083，可与原来的 A/C 双服务演示并行。日志在 `target/run/`。

| 连接到 library 后按顺序执行的 SQL 文件 | 用途 |
| --- | --- |
| [010_web_schema.sql](database/catalog/010_web_schema.sql) | 增加出版信息、馆藏册数及索引，首次从已有副本回填册数 |
| [003_reviews_announcements.sql](database/patch/003_reviews_announcements.sql) | 评价、公告及书目账户授权 |
| [020_book_search.sql](database/catalog/020_book_search.sql) | 存储函数检索通道，和动态 SQL 共用 D 的 BIGINT 编号 |
| [002_procedures.sql](database/loan/002_procedures.sql)、[004_execute_grants.sql](database/loan/004_execute_grants.sql) | 借还、幂等、审计及运行账号授权 |
| [002_demo_books.sql](database/patch/002_demo_books.sql)（可选） | 在原始四本书的演示库里一次性增加 13 本书、作者及副本；预留编号已被使用时中止 |

上述 SQL 用初始化账号执行，例如在工程根目录运行 `gsql -U gaussdb -d library -v ON_ERROR_STOP=1 -f database/catalog/010_web_schema.sql`，再依次替换文件名。B 的整库转储和临时身份服务由 D 的基线与 A 的正式服务替代。控制台中报表、备份和主备切换仍待对应服务接入。应用账号管理和自助注册尚无正式 API。

使用 Docker 时，在 [部署目录](deploy/local-identity) 复制并填写该目录的 `.env.example`，然后运行 `docker compose -f compose.yaml -f compose.web.yaml up --build`。数据库仍由 D 提供。

### 已验证的跨服务流程

- 可用 `python tests/web/reader_catalog_flow.py` 复验书名与作者联查、两个读者切换、书目和借阅数据库身份，以及错误密码处理。测试需要 Python Playwright 及 Chromium，也可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定浏览器程序。
- C 的 `LoanDatabaseIT` 使用应用的真实数据库连接池，在单个回滚事务里验证借出、重复请求、归还和两条审计记录。配置 C 的开发库环境变量后，在 `services/loan-service` 运行 `mvn -Dtest=LoanDatabaseIT test`。测试需要读者有剩余额度以及至少一个可借副本。

## 单独运行 A、C

1. 按 [D 的数据库重建说明](database/opengauss/README.md) 准备 `library` 库，或取得组内现有开发库的连接信息。本机默认端口为 `15432`。
2. 使用教学库统一开发口令时，将 `database/opengauss/env.example` 复制成同目录的 `.env`，在其中的 `LIBRARY_LOCAL_PASSWORD` 填入你实际设置的数据库角色密码。如各角色使用不同密码，分别通过环境变量提供，详见 [联调说明](docs/读者登录联调.md)。
3. 准备 Java 21 和 Maven，在工程根目录打开两个 PowerShell 窗口。第一个运行 `.\start-identity.ps1 -InitReaders`，按提示设置两个读者自己的应用密码。第二个运行 `.\start-local.ps1`。数据库里已有读者密码时，启动 A 使用 `.\start-identity.ps1`。
4. 打开 [读者登录页](http://127.0.0.1:8081/)，分别用 `reader01` 和 `reader02` 登录。页面应依次显示 `db_loan_reader01` 和 `db_loan_reader02`。组内验收步骤和两张实测截图见 [联调说明](docs/读者登录联调.md)。

## C 的借还业务与独立测试

执行借还业务前，用初始化账户连接 `library`，依次通过 `gsql -v ON_ERROR_STOP=1 -f 文件路径` 执行 [借还过程](database/loan/002_procedures.sql) 和 [过程授权](database/loan/004_execute_grants.sql)。

C 单独开发时可以在 8081 运行 `python tests/loan/identity_stub.py`，再启动 C，打开 [借阅页面](http://localhost:8083/) 使用替身令牌 `demo-reader-1`、`demo-reader-2`、`demo-librarian`。联调真实 A 时应先退出占用 8081 的替身。借还回归在专用测试库执行 `python tests/loan/acceptance.py`，SQL 回归使用真实读者登录测试库执行 `gsql -h 127.0.0.1 -p 15432 -U db_loan_reader01 -d library -v ON_ERROR_STOP=1 -f tests/loan/database_regression.sql`。

## 文档

- docs/C交付说明.md：实现、接口、权限、协作边界。
- docs/D联调交接.md：过程签名、数据约定、报表同步。
- docs/验证记录.md：实际执行结果和待验证事项。

C 的独立页面用于借阅接口调试。小组演示从 B 的书屋首页进入。


## 构建和测试

在 services/loan-service 执行 `mvn package`。本机 Windows 若出现 `Unable to establish loopback connection`，可用 `mvn "-DargLine=-Djdk.net.unixdomain.tmpdir=C:/Windows/Temp" package`，前提是该目录可写。正式 Linux 环境无需此参数。

依赖固定为 Spring Boot 3.4.13、Java 21、openGauss JDBC 7.0.0-RC3-og（org.opengauss.Driver）。应用所有数据库连接设置 Asia/Shanghai 时区。
