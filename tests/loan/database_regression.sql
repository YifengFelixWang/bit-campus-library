-- Run as initialization user in D's freshly imported disposable test database.
-- All test changes roll back. Requires C 002 and 004.
\set ON_ERROR_STOP on
BEGIN;
SET SESSION AUTHORIZATION db_loan_reader01;
DO $$
DECLARE n integer; ts timestamp;
BEGIN
 IF session_user<>'db_loan_reader01' THEN RAISE EXCEPTION 'wrong identity'; END IF;
 BEGIN
  UPDATE loan.book_copy SET status='AVAILABLE' WHERE copy_id=2;
  RAISE EXCEPTION 'direct update unexpectedly permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 CALL loan.sp_borrow_copy(1,2,14,'c-regression-borrow',900000001);
 CALL loan.sp_borrow_copy(1,2,14,'c-regression-borrow',900000002);
 SELECT count(*) INTO n FROM loan.loan_record WHERE loan_id IN (900000001,900000002);
 IF n<>1 THEN RAISE EXCEPTION 'idempotency failed'; END IF;
 SELECT count(*) INTO n FROM loan.loan_audit WHERE loan_id=900000001 AND operator_user_id=1 AND request_no='c-regression-borrow';
 IF n<>1 THEN RAISE EXCEPTION 'audit failed'; END IF;
 BEGIN
  CALL loan.sp_borrow_copy(1,2,15,'c-regression-borrow',900000003);
  RAISE EXCEPTION 'expected mismatch';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'IDEMPOTENCY_CONFLICT' THEN RAISE; END IF;
 END;
 BEGIN
  CALL loan.sp_borrow_copy(2,4,14,'c-regression-forbidden',900000004);
  RAISE EXCEPTION 'expected forbidden';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'FORBIDDEN' THEN RAISE; END IF;
 END;
 CALL loan.sp_return_copy(900000001,'c-regression-return');
 SELECT returned_at INTO ts FROM loan.loan_record WHERE loan_id=900000001;
 CALL loan.sp_return_copy(900000001,'c-regression-return');
 CALL loan.sp_return_copy(900000001,'c-regression-return-again');
 IF (SELECT returned_at FROM loan.loan_record WHERE loan_id=900000001)<>ts THEN RAISE EXCEPTION 'return not idempotent'; END IF;
 SELECT count(*) INTO n FROM loan.loan_audit WHERE loan_id=900000001;
 IF n<>2 THEN RAISE EXCEPTION 'duplicate audit'; END IF;
END;
$$;
ROLLBACK;
RESET SESSION AUTHORIZATION;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM loan.loan_record WHERE loan_id=900000001)
 OR EXISTS(SELECT 1 FROM loan.loan_audit WHERE loan_id=900000001)
 OR EXISTS(SELECT 1 FROM loan.request_dedup WHERE request_no LIKE 'c-regression-%')
 OR (SELECT status FROM loan.book_copy WHERE copy_id=2)<>'AVAILABLE'
 THEN RAISE EXCEPTION 'rollback failed'; END IF;
END;
$$;
SELECT 'C_DATABASE_REGRESSION_PASS' AS result;
