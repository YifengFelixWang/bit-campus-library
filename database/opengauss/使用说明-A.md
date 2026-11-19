# 使用说明：A

连接 `localhost:15432`，库名 `library`，用户 `db_iam_runtime`。口令见本机 `.env` 的 `LIBRARY_LOCAL_PASSWORD`。

可以读写 `app_user`、`app_role`、`user_role`、`db_identity_mapping`。

- `user_id` 由身份服务生成。演示用户 1 到 4 已经在种子里：reader01、reader02、librarian01、analyst01。新用户从 5 开始。
- `password_hash` 由你计算后写入。请把种子里的 `REPLACE_WITH_HASH` 换成真实哈希，不要保存明文密码。
- 映射表只存 `user_id`、`service_code`、`db_username`。数据库口令放在各服务的环境变量里。用户登录后，由你的服务选择对应的数据库用户。
- 请把三条内部变更接口写进契约，并创建只能调用这三条接口的 `sync-bot`。字段与定稿表一致，每一行都带 `updatedAt` 和 `deleted`。身份变更至少包括 `userId`、`displayName`、`roleCode`、`updatedAt`、`deleted`。
- 登录、密码哈希、统一入口和应用层拒绝由你负责。不要另写建表脚本。
- 报表路径以后是 `POST /reports/query` 和 `GET /reports/export`。那是 D 的后续工作，这次还没有服务。

开发前按 `06-重建顺序.md` 导入 `dist` 下的两份文件。
