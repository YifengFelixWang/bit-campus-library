-- D executes after C 002, then regenerates dist. No table permissions expanded.
GRANT EXECUTE ON PROCEDURE loan.sp_borrow_copy(bigint,bigint,integer,varchar,bigint)
 TO db_loan_reader01,db_loan_reader02,db_loan_librarian01;
GRANT EXECUTE ON PROCEDURE loan.sp_return_copy(bigint,varchar)
 TO db_loan_reader01,db_loan_reader02,db_loan_librarian01;

