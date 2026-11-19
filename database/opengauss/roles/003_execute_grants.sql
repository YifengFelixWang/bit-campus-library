-- 在 C 提交 sp_borrow_copy 和 sp_return_copy 之后再执行。
-- 这次交给全组的第一份备份不包含这两个过程，因此本文件先不执行。

-- GRANT EXECUTE ON PROCEDURE loan.sp_borrow_copy(BIGINT, BIGINT, INTEGER, VARCHAR)
--     TO db_loan_reader01, db_loan_reader02, db_loan_librarian01;
-- GRANT EXECUTE ON PROCEDURE loan.sp_return_copy(BIGINT, VARCHAR)
--     TO db_loan_reader01, db_loan_reader02, db_loan_librarian01;
