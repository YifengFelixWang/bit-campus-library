# 使用说明：C

读者连接 `db_loan_reader01` 或 `db_loan_reader02`。馆员连接 `db_loan_librarian01`。主机 `localhost`，端口 `15432`，库名 `library`。口令见本机 `.env`。

可以读取 `borrower_account`、`book_copy`、`book_snapshot`、`loan_record`、`request_dedup`、`loan_audit`。馆员还可以维护 `book_copy`、`borrower_account`、`book_snapshot`。借阅记录和副本状态的变更放在存储过程里，读者没有这些表的直接更新权。

- `copy_id` 和 `loan_id` 由借还服务生成。副本 1 到 4、借阅 1 到 6 已用于演示。`user_id` 使用 A 已有的用户编号，读者是 1 和 2。
- 副本状态只用 `AVAILABLE`、`BORROWED`。借阅单状态只用 `BORROWED`、`RETURNED`。
- 请在这些表上编写 `sp_borrow_copy`、`sp_return_copy` 和审计触发器。触发器只写 `loan_audit`。过程不要写 catalog 或 report。
- `borrower_account.max_loan_count` 默认是 5。`request_dedup.request_no` 是主键，并保存 `user_id`、`operation_type`、`copy_id`、`loan_id`。
- `book_snapshot` 由你在借还需要显示书名时写入。不要要求报表服务反过来更新它。
- 请提供借阅变更接口，字段与 `loan_record` 的列一致，并带 `deleted`。
- 读者查询借阅记录时，`user_id` 取服务端已验证的身份。reader01 不能查看 reader02 的记录。
- 当前备份中没有这两个过程，导入后使用 C 的 `../loan/002_procedures.sql` 和 `../loan/004_execute_grants.sql` 创建并授权。
- 演示里的并发、重复请求、过程传参和切换后的新借阅，由你讲。

开发前按 `06-重建顺序.md` 导入 `dist` 下的两份文件。
