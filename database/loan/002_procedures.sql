-- C extension for D's unchanged tables. Run as schema owner with gsql ON_ERROR_STOP.
BEGIN;
SET LOCAL behavior_compat_options = 'plsql_security_definer';
CREATE OR REPLACE FUNCTION loan.actor_id() RETURNS bigint AS $$
BEGIN
 CASE session_user
 WHEN 'db_loan_reader01' THEN RETURN 1;
 WHEN 'db_loan_reader02' THEN RETURN 2;
 WHEN 'db_loan_librarian01' THEN RETURN 3;
 ELSE RAISE EXCEPTION 'FORBIDDEN';
 END CASE;
END;
$$ LANGUAGE plpgsql SECURITY INVOKER;
CREATE OR REPLACE FUNCTION loan.audit_change() RETURNS trigger AS $$
DECLARE k varchar(64);
BEGIN
 IF TG_OP='UPDATE' AND OLD.status=NEW.status THEN RETURN NEW; END IF;
 SELECT request_no INTO k FROM loan.request_dedup WHERE loan_id=NEW.loan_id
 AND operation_type=CASE WHEN NEW.status='BORROWED' THEN 'BORROW' ELSE 'RETURN' END
 ORDER BY created_at DESC,request_no DESC LIMIT 1;
 IF k IS NULL THEN RAISE EXCEPTION 'AUDIT_CONTEXT_MISSING'; END IF;
 INSERT INTO loan.loan_audit(loan_id,old_status,new_status,operator_user_id,request_no,created_at)
 VALUES(NEW.loan_id,CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.status END,NEW.status,loan.actor_id(),k,clock_timestamp());
 RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
DROP TRIGGER IF EXISTS loan_audit_trigger ON loan.loan_record;
CREATE TRIGGER loan_audit_trigger AFTER INSERT OR UPDATE ON loan.loan_record FOR EACH ROW EXECUTE PROCEDURE loan.audit_change();
CREATE OR REPLACE PROCEDURE loan.sp_borrow_copy(p_user bigint,p_copy bigint,p_days integer,p_request varchar,p_new_loan bigint)
SECURITY DEFINER
AS
DECLARE actor bigint; a loan.borrower_account%ROWTYPE; c loan.book_copy%ROWTYPE;
 d loan.request_dedup%ROWTYPE; r loan.loan_record%ROWTYPE; n integer; now_at timestamp;
BEGIN
 actor := loan.actor_id();
 IF p_user IS NULL OR (actor<>3 AND actor<>p_user) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_copy IS NULL OR p_days IS NULL OR p_days<1 OR p_days>30 OR p_request IS NULL OR length(p_request)<8 OR length(p_request)>64 OR p_new_loan IS NULL OR p_new_loan<=6 THEN RAISE EXCEPTION 'INVALID_ARGUMENT'; END IF;
 LOCK TABLE loan.request_dedup IN EXCLUSIVE MODE;
 SELECT * INTO d FROM loan.request_dedup WHERE request_no=p_request;
 IF FOUND THEN
  SELECT * INTO r FROM loan.loan_record WHERE loan_id=d.loan_id;
  IF d.user_id<>actor OR d.operation_type<>'BORROW' OR d.copy_id<>p_copy OR r.user_id<>p_user OR r.due_at-r.borrowed_at<>p_days*interval '1 day' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN;
 END IF;
 SELECT * INTO a FROM loan.borrower_account WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'READER_NOT_FOUND'; END IF;
 IF NOT a.active THEN RAISE EXCEPTION 'READER_DISABLED'; END IF;
 SELECT count(*) INTO n FROM loan.loan_record WHERE user_id=p_user AND status='BORROWED';
 IF n>=a.max_loan_count THEN RAISE EXCEPTION 'LOAN_LIMIT'; END IF;
 SELECT * INTO c FROM loan.book_copy WHERE copy_id=p_copy FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'COPY_NOT_FOUND'; END IF;
 IF c.status<>'AVAILABLE' OR EXISTS(SELECT 1 FROM loan.loan_record WHERE copy_id=p_copy AND status='BORROWED') THEN RAISE EXCEPTION 'COPY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM loan.book_snapshot WHERE book_id=c.book_id) THEN RAISE EXCEPTION 'BOOK_SNAPSHOT_MISSING'; END IF;
 SELECT greatest(clock_timestamp()::timestamp,coalesce(max(updated_at)+interval '1 microsecond',clock_timestamp()::timestamp)) INTO now_at FROM loan.loan_record;
 INSERT INTO loan.request_dedup VALUES(p_request,actor,'BORROW',p_copy,p_new_loan,now_at);
 INSERT INTO loan.loan_record VALUES(p_new_loan,p_user,p_copy,c.book_id,'BORROWED',now_at,now_at+p_days*interval '1 day',NULL,now_at,false);
 UPDATE loan.book_copy SET status='BORROWED',updated_at=now_at WHERE copy_id=p_copy;
END;
/
CREATE OR REPLACE PROCEDURE loan.sp_return_copy(p_loan bigint,p_request varchar)
SECURITY DEFINER
AS
DECLARE actor bigint; d loan.request_dedup%ROWTYPE; r loan.loan_record%ROWTYPE; now_at timestamp;
BEGIN
 actor:=loan.actor_id();
 IF p_loan IS NULL OR p_request IS NULL OR length(p_request)<8 OR length(p_request)>64 THEN RAISE EXCEPTION 'INVALID_ARGUMENT'; END IF;
 LOCK TABLE loan.request_dedup IN EXCLUSIVE MODE;
 SELECT * INTO r FROM loan.loan_record WHERE loan_id=p_loan;
 IF NOT FOUND THEN RAISE EXCEPTION 'LOAN_NOT_FOUND'; END IF;
 IF actor<>3 AND actor<>r.user_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO d FROM loan.request_dedup WHERE request_no=p_request;
 IF FOUND THEN
  IF d.user_id<>actor OR d.operation_type<>'RETURN' OR d.loan_id<>p_loan THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN;
 END IF;
 PERFORM user_id FROM loan.borrower_account WHERE user_id=r.user_id FOR UPDATE;
 PERFORM copy_id FROM loan.book_copy WHERE copy_id=r.copy_id FOR UPDATE;
 SELECT greatest(clock_timestamp()::timestamp,coalesce(max(updated_at)+interval '1 microsecond',clock_timestamp()::timestamp)) INTO now_at FROM loan.loan_record;
 INSERT INTO loan.request_dedup VALUES(p_request,actor,'RETURN',r.copy_id,p_loan,now_at);
 IF r.status='BORROWED' THEN
  UPDATE loan.loan_record SET status='RETURNED',returned_at=now_at,updated_at=now_at WHERE loan_id=p_loan;
  UPDATE loan.book_copy SET status='AVAILABLE',updated_at=now_at WHERE copy_id=r.copy_id;
 END IF;
END;
/
REVOKE ALL ON FUNCTION loan.actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION loan.audit_change() FROM PUBLIC;
REVOKE ALL ON PROCEDURE loan.sp_borrow_copy(bigint,bigint,integer,varchar,bigint) FROM PUBLIC;
REVOKE ALL ON PROCEDURE loan.sp_return_copy(bigint,varchar) FROM PUBLIC;
COMMIT;

