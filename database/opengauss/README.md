# D 的 openGauss 数据库

本目录包含四个业务 schema、演示数据、权限、逻辑备份、ER 图和数据字典。A 的身份服务使用 `iam`，C 的借阅服务使用 `loan`。C 的借还过程和触发器放在同仓库的 [借阅数据库扩展](../loan)。

## 在空开发库重建

准备 D 指定版本的 openGauss 7.0 和 `gsql` 客户端。在能使用初始化账户 `gaussdb` 的终端中，进入 `database/opengauss`，以下命令均在此目录运行。示例使用数据库主机上的本地 socket 和端口 5432。通过主机映射连接时，给 Python 命令加上 `--host 127.0.0.1 --port 15432`，每条 gsql 命令加上 `-h 127.0.0.1 -p 15432`。启用管理员口令认证时，先配置本机 gsql 支持的免交互凭据或在数据库主机使用已有的本地管理登录。

1. **在维护库准备角色和空数据库。** 新环境中先确认能连接 `postgres`。Python 3 脚本提示输入两次自行选择的数据库运行角色密码。课程本地环境的九个运行角色共用这个密码。脚本只通过标准输入将角色模板交给 gsql。管理员口令和读者网页登录密码分别配置。

   ```sh
   gsql -U gaussdb -d postgres -c "SELECT current_database(), current_user"
   python3 init_roles.py
   gsql -U gaussdb -d postgres -c "CREATE DATABASE library"
   ```

   初始化角色使用维护库 `postgres`。openGauss 会在执行 `CREATE USER` 的库中自动创建同名 schema，备份也包含这些 schema。在单独的空库 `library` 中恢复能避免重复创建。已有角色的集群可跳过 `init_roles.py`，空的 `library` 已存在时可跳过建库命令。以下完整恢复只用于空库。

2. **在空库恢复 D 的逻辑备份。** 本版备份包含表、约束、种子数据、C 的借还过程、审计触发器及相应授权。第二条命令用于核对恢复结果。

   ```sh
   gsql -U gaussdb -d library -v ON_ERROR_STOP=1 -f dist/library.sql
   gsql -U gaussdb -d library -v ON_ERROR_STOP=1 -f ../../tests/recovery/15-对象核对清单.sql
   ```

3. **检查读者和数据库身份。** 后两条命令分别以不同的数据库用户连接，使用第 1 步设置的数据库密码。

   ```sh
   gsql -U gaussdb -d library -c "SELECT user_id, username FROM iam.app_user ORDER BY user_id"
   gsql -h 127.0.0.1 -U db_loan_reader01 -d library -c "SELECT current_user, session_user"
   gsql -h 127.0.0.1 -U db_loan_reader02 -d library -c "SELECT current_user, session_user"
   ```

   也可在 Windows 工程里复制本目录的 `env.example` 为本机 `.env`，填入 `LIBRARY_LOCAL_PASSWORD` 供 A、C 的本地启动脚本使用。按 [两个读者的登录与数据库身份](../../docs/读者登录联调.md) 启动服务，首次使用 `-InitReaders` 设置网页密码。共享快照中保留了 A 初始化时识别的 `REPLACE_WITH_HASH` 种子值。

现有联调库可直接执行对象核对脚本。较早的库若缺 C 的过程或授权，依次执行 `../loan/002_procedures.sql` 和 `../loan/004_execute_grants.sql`。完整书屋还需要 B 的书目扩展及书评、公告表，执行顺序见[工程根目录 README](../../README.md)。

## D 维护的源文件

| 内容 | 位置 |
| --- | --- |
| 四个业务 schema | `iam/`、`catalog/`、`loan/`、`report/` 下的 `001_schema.sql` |
| 角色模板及授权 | `roles/`；`dist/001_roles.sql` 与 `roles/001_users.sql` 内容相同 |
| 演示数据和快照 | `seed/001_demo.sql`、`dist/library.sql` |
| 数据结构与约定 | [数据库设计说明书](数据库设计说明书.md)、[权限矩阵](权限矩阵.md)、[ER 图](02-逻辑ER.png)、[数据字典](数据字典.md)、[边界与命名](01-边界与命名.md)、[账号对照](03-账号对照.md) |
| 环境和维护说明 | [环境记录](00-环境记录.md)、[重建和导出顺序](06-重建顺序.md)、[分工说明](使用说明-全组.md) |

重新制作供全组使用的快照时，在空开发库中装载源建表、授权和演示种子，再导出。这样快照中的账号保持可由各组员独立初始化的状态。

---

## 2026-11-24 增量

| 变更 | 脚本 |
| --- | --- |
| 新增 `catalog.ebook`（电子书元数据，一本书一行） | `database/patch/2026-11-24_ebook.sql` |
| `catalog.book.isbn`、`loan.book_snapshot.isbn` 放开为空 | `database/patch/2026-11-24_import_reference_books.sql` 开头 |
| 书目补出版社与出版年 | `database/patch/2026-11-24_catalog_publish_info.sql` |
| 自助注册读者的共享库角色 | `database/patch/2026-11-24_self_registered_readers.sql` |

`catalog.ebook` 只存元数据，文件在宿主机 `/opt/library-files`。当前规模：4 个 schema、23 张表、10 个登录角色。
