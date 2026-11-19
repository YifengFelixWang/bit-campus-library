-- 通过同目录树中的 init_roles.py 运行，由脚本安全填入本机角色密码。
-- 在维护库 postgres 中一次性创建九个业务登录角色。

CREATE USER db_iam_runtime WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_catalog_reader01 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_catalog_reader02 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_catalog_librarian01 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_loan_reader01 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_loan_reader02 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_loan_librarian01 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_report_analyst01 WITH PASSWORD :runtime_password NOSYSADMIN;
CREATE USER db_report_sync WITH PASSWORD :runtime_password NOSYSADMIN;
