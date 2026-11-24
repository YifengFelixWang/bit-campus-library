# D 对象核对复核单（待签字）

- 恢复任务：OP20261123-201832-c5fc
- 目标库：library_verify_ha2
- 备份：library-20261123-201034-9007.dump
- 执行人：E（ops1）
- 结论：接口自动核对 8/8 通过；**D 的人工复核尚未签字**。

## 1. API objectCheck

| 核对项 | 实际 | 期望 | 结果 |
| --- | --- | --- | --- |
| schemas | 4 | 4 | OK |
| loanIndexes | 2 | 2 | OK |
| reportIndexes | 4 | 4 | OK |
| procedures | 2 | 2 | OK |
| auditTrigger | 1 | 1 | OK |
| loanRecords | 7 | 人工基线 | OK |
| books | 4 | 人工基线 | OK |
| users | 4 | 人工基线 | OK |

## 2. 15-对象核对清单.sql 完整输出

```text
schema_name 
-------------
 catalog
 iam
 loan
 report
(4 rows)

 schemaname |  tablename  |      indexname       
------------+-------------+----------------------
 loan       | loan_record | idx_loan_user_status
(1 row)

 schemaname | tablename |   indexname   
------------+-----------+---------------
 loan       | book_copy | idx_copy_book
(1 row)

 schemaname | tablename |         indexname         
------------+-----------+---------------------------
 report     | book_dim  | idx_book_dim_category
 report     | loan_fact | idx_loan_fact_book
 report     | loan_fact | idx_loan_fact_time_status
 report     | loan_fact | idx_loan_fact_user
(4 rows)

 schema_name | procedure_name 
-------------+----------------
 loan        | sp_borrow_copy
 loan        | sp_return_copy
(2 rows)

    trigger_name    | table_name  | schema_name 
--------------------+-------------+-------------
 loan_audit_trigger | loan_record | loan
(1 row)

       grantee       | table_schema |  table_name  | privilege_type 
---------------------+--------------+--------------+----------------
 db_report_analyst01 | report       | book_dim     | SELECT
 db_report_analyst01 | report       | category_dim | SELECT
 db_report_analyst01 | report       | loan_fact    | SELECT
 db_report_analyst01 | report       | reader_dim   | SELECT
(4 rows)

 schema_name | has_usage 
-------------+-----------
 loan        | f
(1 row)

    grantee     | table_schema |   table_name    | privilege_type 
----------------+--------------+-----------------+----------------
 db_report_sync | report       | book_dim        | INSERT
 db_report_sync | report       | book_dim        | SELECT
 db_report_sync | report       | book_dim        | UPDATE
 db_report_sync | report       | category_dim    | INSERT
 db_report_sync | report       | category_dim    | SELECT
 db_report_sync | report       | category_dim    | UPDATE
 db_report_sync | report       | loan_fact       | INSERT
 db_report_sync | report       | loan_fact       | SELECT
 db_report_sync | report       | loan_fact       | UPDATE
 db_report_sync | report       | reader_dim      | INSERT
 db_report_sync | report       | reader_dim      | SELECT
 db_report_sync | report       | reader_dim      | UPDATE
 db_report_sync | report       | sync_checkpoint | INSERT
 db_report_sync | report       | sync_checkpoint | SELECT
 db_report_sync | report       | sync_checkpoint | UPDATE
(15 rows)

total time: 65  ms
```

## 3. D 复核签字

- 复核人：__________
- 日期：__________
- 结论：□ 通过　□ 有异常（异常项：__________）
- 备注：__________
