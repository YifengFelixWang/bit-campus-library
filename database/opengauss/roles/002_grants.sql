-- 在四套建表脚本执行之后、种子之前或之后都可以执行。
-- 只授予本 schema 的表权限。

GRANT CONNECT ON DATABASE library TO
    db_iam_runtime,
    db_catalog_reader01,
    db_catalog_reader02,
    db_catalog_librarian01,
    db_loan_reader01,
    db_loan_reader02,
    db_loan_librarian01,
    db_report_analyst01,
    db_report_sync;

GRANT USAGE ON SCHEMA iam TO db_iam_runtime;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA iam TO db_iam_runtime;

GRANT USAGE ON SCHEMA catalog TO db_catalog_reader01, db_catalog_reader02, db_catalog_librarian01;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog TO db_catalog_reader01, db_catalog_reader02;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA catalog TO db_catalog_librarian01;

GRANT USAGE ON SCHEMA loan TO db_loan_reader01, db_loan_reader02, db_loan_librarian01;
GRANT SELECT ON ALL TABLES IN SCHEMA loan TO db_loan_reader01, db_loan_reader02;
GRANT SELECT ON ALL TABLES IN SCHEMA loan TO db_loan_librarian01;
GRANT INSERT, UPDATE ON loan.book_copy, loan.borrower_account, loan.book_snapshot TO db_loan_librarian01;

GRANT USAGE ON SCHEMA report TO db_report_analyst01, db_report_sync;
GRANT SELECT ON report.category_dim, report.book_dim, report.reader_dim, report.loan_fact TO db_report_analyst01;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA report TO db_report_sync;
