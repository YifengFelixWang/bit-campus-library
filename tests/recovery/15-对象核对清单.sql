-- 在恢复后的 library 库上使用初始化账户 gaussdb 执行。
-- 借还过程能否被 C 服务正常调用须由 C 另行复查；本书封面文件不在本清单范围。

-- 预期：返回 iam、catalog、loan、report 四行
SELECT nspname AS schema_name
FROM pg_namespace
WHERE nspname IN ('iam', 'catalog', 'loan', 'report')
ORDER BY nspname;

-- 预期：loan.loan_record 上存在索引 idx_loan_user_status
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'loan'
  AND tablename = 'loan_record'
  AND indexname = 'idx_loan_user_status';

-- 预期：loan.book_copy 上存在索引 idx_copy_book
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'loan'
  AND tablename = 'book_copy'
  AND indexname = 'idx_copy_book';

-- 预期：report 上存在 idx_book_dim_category、idx_loan_fact_time_status、idx_loan_fact_book、idx_loan_fact_user
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'report'
  AND indexname IN (
    'idx_book_dim_category',
    'idx_loan_fact_time_status',
    'idx_loan_fact_book',
    'idx_loan_fact_user'
  )
ORDER BY indexname;

-- 预期：存在过程 loan.sp_borrow_copy、loan.sp_return_copy
SELECT n.nspname AS schema_name, p.proname AS procedure_name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'loan'
  AND p.proname IN ('sp_borrow_copy', 'sp_return_copy')
ORDER BY p.proname;

-- 预期：存在触发器 loan_audit_trigger（附着于 loan.loan_record）
SELECT tgname AS trigger_name, relname AS table_name, n.nspname AS schema_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT t.tgisinternal
  AND n.nspname = 'loan'
  AND tgname = 'loan_audit_trigger';

-- 预期：db_report_analyst01 对 report.category_dim、book_dim、reader_dim、loan_fact 有 SELECT；对 loan schema 无 USAGE
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'db_report_analyst01'
  AND table_schema = 'report'
  AND table_name IN ('category_dim', 'book_dim', 'reader_dim', 'loan_fact')
ORDER BY table_name, privilege_type;

SELECT nspname AS schema_name, has_schema_privilege('db_report_analyst01', n.oid, 'USAGE') AS has_usage
FROM pg_namespace n
WHERE nspname = 'loan';

-- 预期：db_report_sync 对 report 五张表具备 INSERT、UPDATE（及 SELECT）；见 roles/002_grants.sql
SELECT grantee, table_schema, table_name, privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'db_report_sync'
  AND table_schema = 'report'
ORDER BY table_name, privilege_type;