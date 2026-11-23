--
-- openGauss database dump
--

SET statement_timeout = 0;
SET xmloption = content;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET lockwait_timeout = '0';
SET session_replication_role = replica;
SET client_min_messages = warning;
SET enable_dump_trigger_definer = on;

--
-- Name: BEHAVIORCOMPAT; Type: BEHAVIORCOMPAT; Schema: -; Owner: 
--

SET behavior_compat_options = 'sql_mode_full_group';


--
-- Name: LENGTHSEMANTICS; Type: LENGTHSEMANTICS; Schema: -; Owner: 
--

SET nls_length_semantics = 'byte';


--
-- Name: catalog; Type: SCHEMA; Schema: -; Owner: gaussdb
--

CREATE SCHEMA catalog;


ALTER SCHEMA catalog OWNER TO gaussdb;

--
-- Name: db_catalog_librarian01; Type: SCHEMA; Schema: -; Owner: db_catalog_librarian01
--

CREATE SCHEMA db_catalog_librarian01;


ALTER SCHEMA db_catalog_librarian01 OWNER TO db_catalog_librarian01;

--
-- Name: db_catalog_reader01; Type: SCHEMA; Schema: -; Owner: db_catalog_reader01
--

CREATE SCHEMA db_catalog_reader01;


ALTER SCHEMA db_catalog_reader01 OWNER TO db_catalog_reader01;

--
-- Name: db_catalog_reader02; Type: SCHEMA; Schema: -; Owner: db_catalog_reader02
--

CREATE SCHEMA db_catalog_reader02;


ALTER SCHEMA db_catalog_reader02 OWNER TO db_catalog_reader02;

--
-- Name: db_iam_runtime; Type: SCHEMA; Schema: -; Owner: db_iam_runtime
--

CREATE SCHEMA db_iam_runtime;


ALTER SCHEMA db_iam_runtime OWNER TO db_iam_runtime;

--
-- Name: db_loan_librarian01; Type: SCHEMA; Schema: -; Owner: db_loan_librarian01
--

CREATE SCHEMA db_loan_librarian01;


ALTER SCHEMA db_loan_librarian01 OWNER TO db_loan_librarian01;

--
-- Name: db_loan_reader01; Type: SCHEMA; Schema: -; Owner: db_loan_reader01
--

CREATE SCHEMA db_loan_reader01;


ALTER SCHEMA db_loan_reader01 OWNER TO db_loan_reader01;

--
-- Name: db_loan_reader02; Type: SCHEMA; Schema: -; Owner: db_loan_reader02
--

CREATE SCHEMA db_loan_reader02;


ALTER SCHEMA db_loan_reader02 OWNER TO db_loan_reader02;

--
-- Name: db_report_analyst01; Type: SCHEMA; Schema: -; Owner: db_report_analyst01
--

CREATE SCHEMA db_report_analyst01;


ALTER SCHEMA db_report_analyst01 OWNER TO db_report_analyst01;

--
-- Name: db_report_sync; Type: SCHEMA; Schema: -; Owner: db_report_sync
--

CREATE SCHEMA db_report_sync;


ALTER SCHEMA db_report_sync OWNER TO db_report_sync;

--
-- Name: iam; Type: SCHEMA; Schema: -; Owner: gaussdb
--

CREATE SCHEMA iam;


ALTER SCHEMA iam OWNER TO gaussdb;

--
-- Name: loan; Type: SCHEMA; Schema: -; Owner: gaussdb
--

CREATE SCHEMA loan;


ALTER SCHEMA loan OWNER TO gaussdb;

--
-- Name: report; Type: SCHEMA; Schema: -; Owner: gaussdb
--

CREATE SCHEMA report;


ALTER SCHEMA report OWNER TO gaussdb;

SET search_path = loan;

--
-- Name: actor_id(); Type: FUNCTION; Schema: loan; Owner: gaussdb
--

CREATE FUNCTION actor_id() RETURNS bigint
    LANGUAGE plpgsql NOT SHIPPABLE
 AS $$
BEGIN
 CASE session_user
 WHEN 'db_loan_reader01' THEN RETURN 1;
 WHEN 'db_loan_reader02' THEN RETURN 2;
 WHEN 'db_loan_librarian01' THEN RETURN 3;
 ELSE RAISE EXCEPTION 'FORBIDDEN';
 END CASE;
END;
$$;


ALTER FUNCTION loan.actor_id() OWNER TO gaussdb;

--
-- Name: audit_change(); Type: FUNCTION; Schema: loan; Owner: gaussdb
--

CREATE FUNCTION audit_change() RETURNS trigger
    LANGUAGE plpgsql NOT SHIPPABLE SECURITY DEFINER
 AS $$
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
$$;


-- Restored as gaussdb, which already owns the SECURITY DEFINER routine.

--
-- Name: sp_borrow_copy(bigint, bigint, integer, character varying, bigint); Type: PROCEDURE; Schema: loan; Owner: gaussdb
--

CREATE PROCEDURE sp_borrow_copy(p_user bigint,p_copy bigint,p_days integer,p_request varchar,p_new_loan bigint)  NOT SHIPPABLE SECURITY DEFINER
 AS DECLARE actor bigint; a loan.borrower_account%ROWTYPE; c loan.book_copy%ROWTYPE;
 d loan.request_dedup%ROWTYPE; r loan.loan_record%ROWTYPE; n integer; now_at timestamp;
BEGIN
 actor := loan.actor_id();
 IF p_user IS NULL OR (actor<>3 AND actor<>p_user) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_copy IS NULL OR p_days IS NULL OR p_days<1 OR p_days>30 OR p_request IS NULL OR length(p_request)<8 OR length(p_request)>64 OR p_new_loan IS NULL OR p_new_loan<=6 THEN RAISE EXCEPTION 'INVALID_ARGUMENT'; END IF;
 LOCK TABLE loan.request_dedup IN EXCLUSIVE MODE;

 -- 幂等检查：首次请求查不到是正常情况，用 EXISTS 判断，避免空结果报错
 IF EXISTS(SELECT 1 FROM loan.request_dedup WHERE request_no=p_request) THEN
  SELECT * INTO d FROM loan.request_dedup WHERE request_no=p_request;
  SELECT * INTO r FROM loan.loan_record WHERE loan_id=d.loan_id;
  IF d.user_id<>actor OR d.operation_type<>'BORROW' OR d.copy_id<>p_copy OR r.user_id<>p_user OR r.due_at-r.borrowed_at<>p_days*interval '1 day' THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN;
 END IF;

 IF EXISTS(SELECT 1 FROM loan.borrower_account WHERE user_id=p_user) THEN
  SELECT * INTO a FROM loan.borrower_account WHERE user_id=p_user FOR UPDATE;
 ELSE
  RAISE EXCEPTION 'READER_NOT_FOUND';
 END IF;
 IF NOT a.active THEN RAISE EXCEPTION 'READER_DISABLED'; END IF;
 SELECT count(*) INTO n FROM loan.loan_record WHERE user_id=p_user AND status='BORROWED';
 IF n>=a.max_loan_count THEN RAISE EXCEPTION 'LOAN_LIMIT'; END IF;

 IF EXISTS(SELECT 1 FROM loan.book_copy WHERE copy_id=p_copy) THEN
  SELECT * INTO c FROM loan.book_copy WHERE copy_id=p_copy FOR UPDATE;
 ELSE
  RAISE EXCEPTION 'COPY_NOT_FOUND';
 END IF;
 IF c.status<>'AVAILABLE' OR EXISTS(SELECT 1 FROM loan.loan_record WHERE copy_id=p_copy AND status='BORROWED') THEN RAISE EXCEPTION 'COPY_UNAVAILABLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM loan.book_snapshot WHERE book_id=c.book_id) THEN RAISE EXCEPTION 'BOOK_SNAPSHOT_MISSING'; END IF;

 SELECT greatest(clock_timestamp()::timestamp,coalesce(max(updated_at)+interval '1 microsecond',clock_timestamp()::timestamp)) INTO now_at FROM loan.loan_record;
 INSERT INTO loan.request_dedup VALUES(p_request,actor,'BORROW',p_copy,p_new_loan,now_at);
 INSERT INTO loan.loan_record VALUES(p_new_loan,p_user,p_copy,c.book_id,'BORROWED',now_at,now_at+p_days*interval '1 day',NULL,now_at,false);
 UPDATE loan.book_copy SET status='BORROWED',updated_at=now_at WHERE copy_id=p_copy;
END;
/



--
-- Name: sp_return_copy(bigint, character varying); Type: PROCEDURE; Schema: loan; Owner: gaussdb
--

CREATE PROCEDURE sp_return_copy(p_loan bigint,p_request varchar)  NOT SHIPPABLE SECURITY DEFINER
 AS DECLARE actor bigint; d loan.request_dedup%ROWTYPE; r loan.loan_record%ROWTYPE; now_at timestamp;
BEGIN
 actor:=loan.actor_id();
 IF p_loan IS NULL OR p_request IS NULL OR length(p_request)<8 OR length(p_request)>64 THEN RAISE EXCEPTION 'INVALID_ARGUMENT'; END IF;
 LOCK TABLE loan.request_dedup IN EXCLUSIVE MODE;

 IF EXISTS(SELECT 1 FROM loan.loan_record WHERE loan_id=p_loan) THEN
  SELECT * INTO r FROM loan.loan_record WHERE loan_id=p_loan;
 ELSE
  RAISE EXCEPTION 'LOAN_NOT_FOUND';
 END IF;
 IF actor<>3 AND actor<>r.user_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

 IF EXISTS(SELECT 1 FROM loan.request_dedup WHERE request_no=p_request) THEN
  SELECT * INTO d FROM loan.request_dedup WHERE request_no=p_request;
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



SET search_path = catalog;

SET default_tablespace = '';

SET default_with_oids = false;

--
-- Name: author; Type: TABLE; Schema: catalog; Owner: gaussdb; Tablespace: 
--

CREATE TABLE author (
    author_id bigint NOT NULL,
    author_name character varying(100) NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE catalog.author OWNER TO gaussdb;

--
-- Name: book; Type: TABLE; Schema: catalog; Owner: gaussdb; Tablespace: 
--

CREATE TABLE book (
    book_id bigint NOT NULL,
    isbn character varying(32) NOT NULL,
    title character varying(200) NOT NULL,
    category_id bigint NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE catalog.book OWNER TO gaussdb;

--
-- Name: book_author; Type: TABLE; Schema: catalog; Owner: gaussdb; Tablespace: 
--

CREATE TABLE book_author (
    book_id bigint NOT NULL,
    author_id bigint NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE catalog.book_author OWNER TO gaussdb;

--
-- Name: category; Type: TABLE; Schema: catalog; Owner: gaussdb; Tablespace: 
--

CREATE TABLE category (
    category_id bigint NOT NULL,
    category_name character varying(100) NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE catalog.category OWNER TO gaussdb;

--
-- Name: media; Type: TABLE; Schema: catalog; Owner: gaussdb; Tablespace: 
--

CREATE TABLE media (
    media_id bigint NOT NULL,
    book_id bigint NOT NULL,
    file_url character varying(500) NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE catalog.media OWNER TO gaussdb;

SET search_path = iam;

--
-- Name: app_role; Type: TABLE; Schema: iam; Owner: gaussdb; Tablespace: 
--

CREATE TABLE app_role (
    role_id bigint NOT NULL,
    role_code character varying(32) NOT NULL,
    role_name character varying(32) NOT NULL,
    CONSTRAINT ck_app_role_code CHECK (((role_code)::text = ANY (ARRAY[('READER'::character varying)::text, ('LIBRARIAN'::character varying)::text, ('ANALYST'::character varying)::text, ('OPERATOR'::character varying)::text])))
)
WITH (orientation=row, compression=no);


ALTER TABLE iam.app_role OWNER TO gaussdb;

--
-- Name: app_user; Type: TABLE; Schema: iam; Owner: gaussdb; Tablespace: 
--

CREATE TABLE app_user (
    user_id bigint NOT NULL,
    username character varying(64) NOT NULL,
    password_hash character varying(255) NOT NULL,
    display_name character varying(100) NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE iam.app_user OWNER TO gaussdb;

--
-- Name: db_identity_mapping; Type: TABLE; Schema: iam; Owner: gaussdb; Tablespace: 
--

CREATE TABLE db_identity_mapping (
    user_id bigint NOT NULL,
    service_code character varying(32) NOT NULL,
    db_username character varying(64) NOT NULL,
    CONSTRAINT ck_mapping_service CHECK (((service_code)::text = ANY (ARRAY[('iam'::character varying)::text, ('catalog'::character varying)::text, ('loan'::character varying)::text, ('report'::character varying)::text])))
)
WITH (orientation=row, compression=no);


ALTER TABLE iam.db_identity_mapping OWNER TO gaussdb;

--
-- Name: user_role; Type: TABLE; Schema: iam; Owner: gaussdb; Tablespace: 
--

CREATE TABLE user_role (
    user_id bigint NOT NULL,
    role_id bigint NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE iam.user_role OWNER TO gaussdb;

SET search_path = loan;

--
-- Name: book_copy; Type: TABLE; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE TABLE book_copy (
    copy_id bigint NOT NULL,
    book_id bigint NOT NULL,
    barcode character varying(64) NOT NULL,
    status character varying(32) NOT NULL,
    updated_at timestamp without time zone NOT NULL,
    CONSTRAINT ck_copy_status CHECK (((status)::text = ANY (ARRAY[('AVAILABLE'::character varying)::text, ('BORROWED'::character varying)::text])))
)
WITH (orientation=row, compression=no);


ALTER TABLE loan.book_copy OWNER TO gaussdb;

--
-- Name: book_snapshot; Type: TABLE; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE TABLE book_snapshot (
    book_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    isbn character varying(32) NOT NULL,
    updated_at timestamp without time zone NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE loan.book_snapshot OWNER TO gaussdb;

--
-- Name: borrower_account; Type: TABLE; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE TABLE borrower_account (
    user_id bigint NOT NULL,
    max_loan_count integer DEFAULT 5 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE loan.borrower_account OWNER TO gaussdb;

--
-- Name: loan_audit; Type: TABLE; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE TABLE loan_audit (
    audit_id bigint NOT NULL,
    loan_id bigint NOT NULL,
    old_status character varying(32),
    new_status character varying(32),
    operator_user_id bigint NOT NULL,
    request_no character varying(64),
    created_at timestamp without time zone NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE loan.loan_audit OWNER TO gaussdb;

--
-- Name: loan_audit_audit_id_seq; Type: SEQUENCE; Schema: loan; Owner: gaussdb
--

CREATE  SEQUENCE loan_audit_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE loan.loan_audit_audit_id_seq OWNER TO gaussdb;

--
-- Name: loan_audit_audit_id_seq; Type: LARGE SEQUENCE OWNED BY; Schema: loan; Owner: gaussdb
--

ALTER  SEQUENCE loan_audit_audit_id_seq OWNED BY loan_audit.audit_id;


--
-- Name: loan_record; Type: TABLE; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE TABLE loan_record (
    loan_id bigint NOT NULL,
    user_id bigint NOT NULL,
    copy_id bigint NOT NULL,
    book_id bigint NOT NULL,
    status character varying(32) NOT NULL,
    borrowed_at timestamp without time zone NOT NULL,
    due_at timestamp without time zone,
    returned_at timestamp without time zone,
    updated_at timestamp without time zone NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    CONSTRAINT ck_loan_status CHECK (((status)::text = ANY (ARRAY[('BORROWED'::character varying)::text, ('RETURNED'::character varying)::text])))
)
WITH (orientation=row, compression=no);


ALTER TABLE loan.loan_record OWNER TO gaussdb;

--
-- Name: request_dedup; Type: TABLE; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE TABLE request_dedup (
    request_no character varying(64) NOT NULL,
    user_id bigint NOT NULL,
    operation_type character varying(32) NOT NULL,
    copy_id bigint NOT NULL,
    loan_id bigint,
    created_at timestamp without time zone NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE loan.request_dedup OWNER TO gaussdb;

SET search_path = report;

--
-- Name: book_dim; Type: TABLE; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE TABLE book_dim (
    book_id bigint NOT NULL,
    title character varying(200) NOT NULL,
    isbn character varying(32),
    category_id bigint NOT NULL,
    author_names character varying(500) DEFAULT NULL::character varying NOT NULL,
    source_updated_at timestamp without time zone NOT NULL,
    synced_at timestamp without time zone DEFAULT pg_systimestamp() NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE report.book_dim OWNER TO gaussdb;

--
-- Name: category_dim; Type: TABLE; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE TABLE category_dim (
    category_id bigint NOT NULL,
    category_name character varying(100) NOT NULL,
    source_updated_at timestamp without time zone NOT NULL,
    synced_at timestamp without time zone DEFAULT pg_systimestamp() NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE report.category_dim OWNER TO gaussdb;

--
-- Name: loan_fact; Type: TABLE; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE TABLE loan_fact (
    loan_id bigint NOT NULL,
    user_id bigint NOT NULL,
    book_id bigint NOT NULL,
    copy_id bigint NOT NULL,
    status character varying(32) NOT NULL,
    borrowed_at timestamp without time zone NOT NULL,
    due_at timestamp without time zone,
    returned_at timestamp without time zone,
    source_updated_at timestamp without time zone NOT NULL,
    synced_at timestamp without time zone DEFAULT pg_systimestamp() NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE report.loan_fact OWNER TO gaussdb;

--
-- Name: reader_dim; Type: TABLE; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE TABLE reader_dim (
    user_id bigint NOT NULL,
    display_name character varying(100) NOT NULL,
    role_code character varying(32) NOT NULL,
    source_updated_at timestamp without time zone NOT NULL,
    synced_at timestamp without time zone DEFAULT pg_systimestamp() NOT NULL,
    deleted boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE report.reader_dim OWNER TO gaussdb;

--
-- Name: sync_checkpoint; Type: TABLE; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE TABLE sync_checkpoint (
    source_name character varying(32) NOT NULL,
    cursor_updated_at timestamp without time zone,
    cursor_id bigint,
    last_success_at timestamp without time zone,
    last_error character varying(500),
    status character varying(32) NOT NULL
)
WITH (orientation=row, compression=no);


ALTER TABLE report.sync_checkpoint OWNER TO gaussdb;

SET search_path = loan;

--
-- Name: audit_id; Type: DEFAULT; Schema: loan; Owner: gaussdb
--

ALTER TABLE loan_audit ALTER COLUMN audit_id SET DEFAULT nextval('loan_audit_audit_id_seq'::regclass);


SET search_path = catalog;

--
-- Data for Name: author; Type: TABLE DATA; Schema: catalog; Owner: gaussdb
--

COPY catalog.author (author_id, author_name, updated_at, deleted) FROM stdin;
1	曹雪芹	2026-10-01 09:00:00	f
2	余华	2026-10-01 09:00:00	f
3	钱钟书	2026-10-01 09:00:00	f
4	Abraham Silberschatz	2026-10-01 09:00:00	f
\.
;

--
-- Data for Name: book; Type: TABLE DATA; Schema: catalog; Owner: gaussdb
--

COPY catalog.book (book_id, isbn, title, category_id, updated_at, deleted) FROM stdin;
1	978-7-00000001	红楼梦	1	2026-10-01 09:00:00	f
2	978-7-00000002	活着	1	2026-10-01 09:00:00	f
3	978-7-00000003	围城	1	2026-10-01 09:00:00	f
4	978-7-00000004	数据库系统概念	2	2026-10-01 09:00:00	f
\.
;

--
-- Data for Name: book_author; Type: TABLE DATA; Schema: catalog; Owner: gaussdb
--

COPY catalog.book_author (book_id, author_id) FROM stdin;
1	1
2	2
3	3
4	4
\.
;

--
-- Data for Name: category; Type: TABLE DATA; Schema: catalog; Owner: gaussdb
--

COPY catalog.category (category_id, category_name, updated_at, deleted) FROM stdin;
1	文学	2026-10-01 09:00:00	f
2	计算机	2026-10-01 09:00:00	f
\.
;

--
-- Data for Name: media; Type: TABLE DATA; Schema: catalog; Owner: gaussdb
--

COPY catalog.media (media_id, book_id, file_url, updated_at, deleted) FROM stdin;
1	1	covers/book-1.jpg	2026-10-01 09:00:00	f
2	2	covers/book-2.jpg	2026-10-01 09:00:00	f
3	3	covers/book-3.jpg	2026-10-01 09:00:00	f
4	4	covers/book-4.jpg	2026-10-01 09:00:00	f
\.
;

SET search_path = iam;

--
-- Data for Name: app_role; Type: TABLE DATA; Schema: iam; Owner: gaussdb
--

COPY iam.app_role (role_id, role_code, role_name) FROM stdin;
1	READER	读者
2	LIBRARIAN	馆员
3	ANALYST	数据分析员
4	OPERATOR	运维管理员
\.
;

--
-- Data for Name: app_user; Type: TABLE DATA; Schema: iam; Owner: gaussdb
--

COPY iam.app_user (user_id, username, password_hash, display_name, enabled, updated_at, deleted) FROM stdin;
1	reader01	REPLACE_WITH_HASH	读者一	t	2026-10-01 09:00:00	f
2	reader02	REPLACE_WITH_HASH	读者二	t	2026-10-01 09:00:00	f
3	librarian01	REPLACE_WITH_HASH	馆员一	t	2026-10-01 09:00:00	f
4	analyst01	REPLACE_WITH_HASH	分析员一	t	2026-10-01 09:00:00	f
\.
;

--
-- Data for Name: db_identity_mapping; Type: TABLE DATA; Schema: iam; Owner: gaussdb
--

COPY iam.db_identity_mapping (user_id, service_code, db_username) FROM stdin;
1	catalog	db_catalog_reader01
1	loan	db_loan_reader01
2	catalog	db_catalog_reader02
2	loan	db_loan_reader02
3	catalog	db_catalog_librarian01
3	loan	db_loan_librarian01
4	report	db_report_analyst01
\.
;

--
-- Data for Name: user_role; Type: TABLE DATA; Schema: iam; Owner: gaussdb
--

COPY iam.user_role (user_id, role_id) FROM stdin;
1	1
2	1
3	2
4	3
\.
;

SET search_path = loan;

--
-- Data for Name: book_copy; Type: TABLE DATA; Schema: loan; Owner: gaussdb
--

COPY loan.book_copy (copy_id, book_id, barcode, status, updated_at) FROM stdin;
1	1	BC0001	BORROWED	2026-10-01 10:00:00
2	2	BC0002	AVAILABLE	2026-09-20 10:00:00
3	3	BC0003	BORROWED	2026-10-05 10:00:00
4	4	BC0004	AVAILABLE	2026-07-18 10:00:00
\.
;

--
-- Data for Name: book_snapshot; Type: TABLE DATA; Schema: loan; Owner: gaussdb
--

COPY loan.book_snapshot (book_id, title, isbn, updated_at) FROM stdin;
1	红楼梦	978-7-00000001	2026-10-01 09:00:00
2	活着	978-7-00000002	2026-10-01 09:00:00
3	围城	978-7-00000003	2026-10-01 09:00:00
4	数据库系统概念	978-7-00000004	2026-10-01 09:00:00
\.
;

--
-- Data for Name: borrower_account; Type: TABLE DATA; Schema: loan; Owner: gaussdb
--

COPY loan.borrower_account (user_id, max_loan_count, active, updated_at) FROM stdin;
1	5	t	2026-10-01 09:00:00
2	5	t	2026-10-01 09:00:00
\.
;

--
-- Data for Name: loan_audit; Type: TABLE DATA; Schema: loan; Owner: gaussdb
--

COPY loan.loan_audit (audit_id, loan_id, old_status, new_status, operator_user_id, request_no, created_at) FROM stdin;
\.
;

--
-- Name: loan_audit_audit_id_seq; Type: SEQUENCE SET; Schema: loan; Owner: gaussdb
--

SELECT pg_catalog.setval('loan_audit_audit_id_seq', 1, false);


--
-- Data for Name: loan_record; Type: TABLE DATA; Schema: loan; Owner: gaussdb
--

COPY loan.loan_record (loan_id, user_id, copy_id, book_id, status, borrowed_at, due_at, returned_at, updated_at, deleted) FROM stdin;
1	1	1	1	BORROWED	2026-10-01 10:00:00	2026-10-31 10:00:00	\N	2026-10-01 10:00:00	f
2	1	2	2	RETURNED	2026-09-01 10:00:00	2026-09-30 10:00:00	2026-09-20 10:00:00	2026-09-20 10:00:00	f
3	2	2	2	RETURNED	2026-08-01 10:00:00	2026-08-31 10:00:00	2026-08-15 10:00:00	2026-08-15 10:00:00	f
4	2	3	3	BORROWED	2026-10-05 10:00:00	2026-11-05 10:00:00	\N	2026-10-05 10:00:00	f
5	1	4	4	RETURNED	2026-07-01 10:00:00	2026-07-31 10:00:00	2026-07-18 10:00:00	2026-07-18 10:00:00	f
6	2	4	4	RETURNED	2026-06-01 10:00:00	2026-06-30 10:00:00	2026-06-20 10:00:00	2026-06-20 10:00:00	f
\.
;

--
-- Data for Name: request_dedup; Type: TABLE DATA; Schema: loan; Owner: gaussdb
--

COPY loan.request_dedup (request_no, user_id, operation_type, copy_id, loan_id, created_at) FROM stdin;
\.
;

SET search_path = report;

--
-- Data for Name: book_dim; Type: TABLE DATA; Schema: report; Owner: gaussdb
--

COPY report.book_dim (book_id, title, isbn, category_id, author_names, source_updated_at, synced_at, deleted) FROM stdin;
1	红楼梦	978-7-00000001	1	曹雪芹	2026-10-01 09:00:00	2026-10-29 08:23:57.841881	f
2	活着	978-7-00000002	1	余华	2026-10-01 09:00:00	2026-10-29 08:23:57.841881	f
3	围城	978-7-00000003	1	钱钟书	2026-10-01 09:00:00	2026-10-29 08:23:57.841881	f
4	数据库系统概念	978-7-00000004	2	Abraham Silberschatz	2026-10-01 09:00:00	2026-10-29 08:23:57.841881	f
\.
;

--
-- Data for Name: category_dim; Type: TABLE DATA; Schema: report; Owner: gaussdb
--

COPY report.category_dim (category_id, category_name, source_updated_at, synced_at, deleted) FROM stdin;
1	文学	2026-10-01 09:00:00	2026-10-29 08:23:57.837629	f
2	计算机	2026-10-01 09:00:00	2026-10-29 08:23:57.837629	f
\.
;

--
-- Data for Name: loan_fact; Type: TABLE DATA; Schema: report; Owner: gaussdb
--

COPY report.loan_fact (loan_id, user_id, book_id, copy_id, status, borrowed_at, due_at, returned_at, source_updated_at, synced_at, deleted) FROM stdin;
1	1	1	1	BORROWED	2026-10-01 10:00:00	2026-10-31 10:00:00	\N	2026-10-01 10:00:00	2026-10-29 08:23:57.853714	f
2	1	2	2	RETURNED	2026-09-01 10:00:00	2026-09-30 10:00:00	2026-09-20 10:00:00	2026-09-20 10:00:00	2026-10-29 08:23:57.853714	f
3	2	2	2	RETURNED	2026-08-01 10:00:00	2026-08-31 10:00:00	2026-08-15 10:00:00	2026-08-15 10:00:00	2026-10-29 08:23:57.853714	f
4	2	3	3	BORROWED	2026-10-05 10:00:00	2026-11-05 10:00:00	\N	2026-10-05 10:00:00	2026-10-29 08:23:57.853714	f
5	1	4	4	RETURNED	2026-07-01 10:00:00	2026-07-31 10:00:00	2026-07-18 10:00:00	2026-07-18 10:00:00	2026-10-29 08:23:57.853714	f
6	2	4	4	RETURNED	2026-06-01 10:00:00	2026-06-30 10:00:00	2026-06-20 10:00:00	2026-06-20 10:00:00	2026-10-29 08:23:57.853714	f
\.
;

--
-- Data for Name: reader_dim; Type: TABLE DATA; Schema: report; Owner: gaussdb
--

COPY report.reader_dim (user_id, display_name, role_code, source_updated_at, synced_at, deleted) FROM stdin;
1	读者一	READER	2026-10-01 09:00:00	2026-10-29 08:23:57.847483	f
2	读者二	READER	2026-10-01 09:00:00	2026-10-29 08:23:57.847483	f
\.
;

--
-- Data for Name: sync_checkpoint; Type: TABLE DATA; Schema: report; Owner: gaussdb
--

COPY report.sync_checkpoint (source_name, cursor_updated_at, cursor_id, last_success_at, last_error, status) FROM stdin;
iam	\N	\N	\N	\N	SEED
catalog	\N	\N	\N	\N	SEED
loan	\N	\N	\N	\N	SEED
\.
;

SET search_path = catalog;

--
-- Name: author_pkey; Type: CONSTRAINT; Schema: catalog; Owner: gaussdb; Tablespace: 
--

ALTER TABLE author
    ADD CONSTRAINT author_pkey PRIMARY KEY  (author_id);


--
-- Name: book_author_pkey; Type: CONSTRAINT; Schema: catalog; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book_author
    ADD CONSTRAINT book_author_pkey PRIMARY KEY  (book_id, author_id);


--
-- Name: book_isbn_key; Type: CONSTRAINT; Schema: catalog; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book
    ADD CONSTRAINT book_isbn_key UNIQUE (isbn);


--
-- Name: book_pkey; Type: CONSTRAINT; Schema: catalog; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book
    ADD CONSTRAINT book_pkey PRIMARY KEY  (book_id);


--
-- Name: category_pkey; Type: CONSTRAINT; Schema: catalog; Owner: gaussdb; Tablespace: 
--

ALTER TABLE category
    ADD CONSTRAINT category_pkey PRIMARY KEY  (category_id);


--
-- Name: media_pkey; Type: CONSTRAINT; Schema: catalog; Owner: gaussdb; Tablespace: 
--

ALTER TABLE media
    ADD CONSTRAINT media_pkey PRIMARY KEY  (media_id);


SET search_path = iam;

--
-- Name: app_role_pkey; Type: CONSTRAINT; Schema: iam; Owner: gaussdb; Tablespace: 
--

ALTER TABLE app_role
    ADD CONSTRAINT app_role_pkey PRIMARY KEY  (role_id);


--
-- Name: app_role_role_code_key; Type: CONSTRAINT; Schema: iam; Owner: gaussdb; Tablespace: 
--

ALTER TABLE app_role
    ADD CONSTRAINT app_role_role_code_key UNIQUE (role_code);


--
-- Name: app_user_pkey; Type: CONSTRAINT; Schema: iam; Owner: gaussdb; Tablespace: 
--

ALTER TABLE app_user
    ADD CONSTRAINT app_user_pkey PRIMARY KEY  (user_id);


--
-- Name: app_user_username_key; Type: CONSTRAINT; Schema: iam; Owner: gaussdb; Tablespace: 
--

ALTER TABLE app_user
    ADD CONSTRAINT app_user_username_key UNIQUE (username);


--
-- Name: db_identity_mapping_pkey; Type: CONSTRAINT; Schema: iam; Owner: gaussdb; Tablespace: 
--

ALTER TABLE db_identity_mapping
    ADD CONSTRAINT db_identity_mapping_pkey PRIMARY KEY  (user_id, service_code);


--
-- Name: user_role_pkey; Type: CONSTRAINT; Schema: iam; Owner: gaussdb; Tablespace: 
--

ALTER TABLE user_role
    ADD CONSTRAINT user_role_pkey PRIMARY KEY  (user_id, role_id);


SET search_path = loan;

--
-- Name: book_copy_barcode_key; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book_copy
    ADD CONSTRAINT book_copy_barcode_key UNIQUE (barcode);


--
-- Name: book_copy_pkey; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book_copy
    ADD CONSTRAINT book_copy_pkey PRIMARY KEY  (copy_id);


--
-- Name: book_snapshot_pkey; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book_snapshot
    ADD CONSTRAINT book_snapshot_pkey PRIMARY KEY  (book_id);


--
-- Name: borrower_account_pkey; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE borrower_account
    ADD CONSTRAINT borrower_account_pkey PRIMARY KEY  (user_id);


--
-- Name: loan_audit_pkey; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE loan_audit
    ADD CONSTRAINT loan_audit_pkey PRIMARY KEY  (audit_id);


--
-- Name: loan_record_pkey; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE loan_record
    ADD CONSTRAINT loan_record_pkey PRIMARY KEY  (loan_id);


--
-- Name: request_dedup_pkey; Type: CONSTRAINT; Schema: loan; Owner: gaussdb; Tablespace: 
--

ALTER TABLE request_dedup
    ADD CONSTRAINT request_dedup_pkey PRIMARY KEY  (request_no);


SET search_path = report;

--
-- Name: book_dim_pkey; Type: CONSTRAINT; Schema: report; Owner: gaussdb; Tablespace: 
--

ALTER TABLE book_dim
    ADD CONSTRAINT book_dim_pkey PRIMARY KEY  (book_id);


--
-- Name: category_dim_pkey; Type: CONSTRAINT; Schema: report; Owner: gaussdb; Tablespace: 
--

ALTER TABLE category_dim
    ADD CONSTRAINT category_dim_pkey PRIMARY KEY  (category_id);


--
-- Name: loan_fact_pkey; Type: CONSTRAINT; Schema: report; Owner: gaussdb; Tablespace: 
--

ALTER TABLE loan_fact
    ADD CONSTRAINT loan_fact_pkey PRIMARY KEY  (loan_id);


--
-- Name: reader_dim_pkey; Type: CONSTRAINT; Schema: report; Owner: gaussdb; Tablespace: 
--

ALTER TABLE reader_dim
    ADD CONSTRAINT reader_dim_pkey PRIMARY KEY  (user_id);


--
-- Name: sync_checkpoint_pkey; Type: CONSTRAINT; Schema: report; Owner: gaussdb; Tablespace: 
--

ALTER TABLE sync_checkpoint
    ADD CONSTRAINT sync_checkpoint_pkey PRIMARY KEY  (source_name);


SET search_path = catalog;

--
-- Name: idx_book_category; Type: INDEX; Schema: catalog; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_book_category ON book USING btree (category_id) TABLESPACE pg_default;


SET search_path = loan;

--
-- Name: idx_copy_book; Type: INDEX; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_copy_book ON book_copy USING btree (book_id) TABLESPACE pg_default;


--
-- Name: idx_loan_user_status; Type: INDEX; Schema: loan; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_loan_user_status ON loan_record USING btree (user_id, status) TABLESPACE pg_default;


SET search_path = report;

--
-- Name: idx_book_dim_category; Type: INDEX; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_book_dim_category ON book_dim USING btree (category_id) TABLESPACE pg_default;


--
-- Name: idx_loan_fact_book; Type: INDEX; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_loan_fact_book ON loan_fact USING btree (book_id) TABLESPACE pg_default;


--
-- Name: idx_loan_fact_time_status; Type: INDEX; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_loan_fact_time_status ON loan_fact USING btree (borrowed_at, status) TABLESPACE pg_default;


--
-- Name: idx_loan_fact_user; Type: INDEX; Schema: report; Owner: gaussdb; Tablespace: 
--

CREATE INDEX idx_loan_fact_user ON loan_fact USING btree (user_id) TABLESPACE pg_default;


SET search_path = loan;

--
-- Name: loan_audit_trigger; Type: TRIGGER; Schema: loan; Owner: gaussdb
--

BEGIN;
CREATE TRIGGER loan_audit_trigger AFTER INSERT OR UPDATE ON loan_record FOR EACH ROW EXECUTE PROCEDURE audit_change();
ALTER TRIGGER loan_audit_trigger ON loan_record OWNER TO gaussdb;




COMMIT;

SET search_path = catalog;

--
-- Name: fk_book_author_author; Type: FK CONSTRAINT; Schema: catalog; Owner: gaussdb
--

ALTER TABLE book_author
    ADD CONSTRAINT fk_book_author_author FOREIGN KEY (author_id) REFERENCES author(author_id);


--
-- Name: fk_book_author_book; Type: FK CONSTRAINT; Schema: catalog; Owner: gaussdb
--

ALTER TABLE book_author
    ADD CONSTRAINT fk_book_author_book FOREIGN KEY (book_id) REFERENCES book(book_id);


--
-- Name: fk_book_category; Type: FK CONSTRAINT; Schema: catalog; Owner: gaussdb
--

ALTER TABLE book
    ADD CONSTRAINT fk_book_category FOREIGN KEY (category_id) REFERENCES category(category_id);


--
-- Name: fk_media_book; Type: FK CONSTRAINT; Schema: catalog; Owner: gaussdb
--

ALTER TABLE media
    ADD CONSTRAINT fk_media_book FOREIGN KEY (book_id) REFERENCES book(book_id);


SET search_path = iam;

--
-- Name: fk_mapping_user; Type: FK CONSTRAINT; Schema: iam; Owner: gaussdb
--

ALTER TABLE db_identity_mapping
    ADD CONSTRAINT fk_mapping_user FOREIGN KEY (user_id) REFERENCES app_user(user_id);


--
-- Name: fk_user_role_role; Type: FK CONSTRAINT; Schema: iam; Owner: gaussdb
--

ALTER TABLE user_role
    ADD CONSTRAINT fk_user_role_role FOREIGN KEY (role_id) REFERENCES app_role(role_id);


--
-- Name: fk_user_role_user; Type: FK CONSTRAINT; Schema: iam; Owner: gaussdb
--

ALTER TABLE user_role
    ADD CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES app_user(user_id);


SET search_path = loan;

--
-- Name: fk_audit_loan; Type: FK CONSTRAINT; Schema: loan; Owner: gaussdb
--

ALTER TABLE loan_audit
    ADD CONSTRAINT fk_audit_loan FOREIGN KEY (loan_id) REFERENCES loan_record(loan_id);


--
-- Name: fk_loan_borrower; Type: FK CONSTRAINT; Schema: loan; Owner: gaussdb
--

ALTER TABLE loan_record
    ADD CONSTRAINT fk_loan_borrower FOREIGN KEY (user_id) REFERENCES borrower_account(user_id);


--
-- Name: fk_loan_copy; Type: FK CONSTRAINT; Schema: loan; Owner: gaussdb
--

ALTER TABLE loan_record
    ADD CONSTRAINT fk_loan_copy FOREIGN KEY (copy_id) REFERENCES book_copy(copy_id);


--
-- Name: fk_loan_snapshot; Type: FK CONSTRAINT; Schema: loan; Owner: gaussdb
--

ALTER TABLE loan_record
    ADD CONSTRAINT fk_loan_snapshot FOREIGN KEY (book_id) REFERENCES book_snapshot(book_id);


--
-- Name: catalog; Type: ACL; Schema: -; Owner: gaussdb
--

REVOKE ALL ON SCHEMA catalog FROM PUBLIC;
REVOKE ALL ON SCHEMA catalog FROM gaussdb;
GRANT CREATE,USAGE ON SCHEMA catalog TO gaussdb;
GRANT USAGE ON SCHEMA catalog TO db_catalog_reader01;
GRANT USAGE ON SCHEMA catalog TO db_catalog_reader02;
GRANT USAGE ON SCHEMA catalog TO db_catalog_librarian01;


--
-- Name: iam; Type: ACL; Schema: -; Owner: gaussdb
--

REVOKE ALL ON SCHEMA iam FROM PUBLIC;
REVOKE ALL ON SCHEMA iam FROM gaussdb;
GRANT CREATE,USAGE ON SCHEMA iam TO gaussdb;
GRANT USAGE ON SCHEMA iam TO db_iam_runtime;


--
-- Name: loan; Type: ACL; Schema: -; Owner: gaussdb
--

REVOKE ALL ON SCHEMA loan FROM PUBLIC;
REVOKE ALL ON SCHEMA loan FROM gaussdb;
GRANT CREATE,USAGE ON SCHEMA loan TO gaussdb;
GRANT USAGE ON SCHEMA loan TO db_loan_reader01;
GRANT USAGE ON SCHEMA loan TO db_loan_reader02;
GRANT USAGE ON SCHEMA loan TO db_loan_librarian01;


--
-- Name: report; Type: ACL; Schema: -; Owner: gaussdb
--

REVOKE ALL ON SCHEMA report FROM PUBLIC;
REVOKE ALL ON SCHEMA report FROM gaussdb;
GRANT CREATE,USAGE ON SCHEMA report TO gaussdb;
GRANT USAGE ON SCHEMA report TO db_report_analyst01;
GRANT USAGE ON SCHEMA report TO db_report_sync;


--
-- Name: actor_id(); Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON FUNCTION actor_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION actor_id() FROM gaussdb;
GRANT EXECUTE ON FUNCTION actor_id() TO gaussdb;


--
-- Name: audit_change(); Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON FUNCTION audit_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_change() FROM gaussdb;
GRANT EXECUTE ON FUNCTION audit_change() TO gaussdb;


--
-- Name: sp_borrow_copy(bigint, bigint, integer, character varying, bigint); Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON PROCEDURE sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request character varying, p_new_loan bigint) FROM PUBLIC;
REVOKE ALL ON PROCEDURE sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request character varying, p_new_loan bigint) FROM gaussdb;
GRANT EXECUTE ON PROCEDURE sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request character varying, p_new_loan bigint) TO gaussdb;
GRANT EXECUTE ON PROCEDURE sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request character varying, p_new_loan bigint) TO db_loan_reader01;
GRANT EXECUTE ON PROCEDURE sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request character varying, p_new_loan bigint) TO db_loan_reader02;
GRANT EXECUTE ON PROCEDURE sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request character varying, p_new_loan bigint) TO db_loan_librarian01;


--
-- Name: sp_return_copy(bigint, character varying); Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON PROCEDURE sp_return_copy(p_loan bigint, p_request character varying) FROM PUBLIC;
REVOKE ALL ON PROCEDURE sp_return_copy(p_loan bigint, p_request character varying) FROM gaussdb;
GRANT EXECUTE ON PROCEDURE sp_return_copy(p_loan bigint, p_request character varying) TO gaussdb;
GRANT EXECUTE ON PROCEDURE sp_return_copy(p_loan bigint, p_request character varying) TO db_loan_reader01;
GRANT EXECUTE ON PROCEDURE sp_return_copy(p_loan bigint, p_request character varying) TO db_loan_reader02;
GRANT EXECUTE ON PROCEDURE sp_return_copy(p_loan bigint, p_request character varying) TO db_loan_librarian01;


SET search_path = catalog;

--
-- Name: author; Type: ACL; Schema: catalog; Owner: gaussdb
--

REVOKE ALL ON TABLE author FROM PUBLIC;
REVOKE ALL ON TABLE author FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE author TO gaussdb;
GRANT SELECT ON TABLE author TO db_catalog_reader01;
GRANT SELECT ON TABLE author TO db_catalog_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE author TO db_catalog_librarian01;


--
-- Name: book; Type: ACL; Schema: catalog; Owner: gaussdb
--

REVOKE ALL ON TABLE book FROM PUBLIC;
REVOKE ALL ON TABLE book FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE book TO gaussdb;
GRANT SELECT ON TABLE book TO db_catalog_reader01;
GRANT SELECT ON TABLE book TO db_catalog_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE book TO db_catalog_librarian01;


--
-- Name: book_author; Type: ACL; Schema: catalog; Owner: gaussdb
--

REVOKE ALL ON TABLE book_author FROM PUBLIC;
REVOKE ALL ON TABLE book_author FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE book_author TO gaussdb;
GRANT SELECT ON TABLE book_author TO db_catalog_reader01;
GRANT SELECT ON TABLE book_author TO db_catalog_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE book_author TO db_catalog_librarian01;


--
-- Name: category; Type: ACL; Schema: catalog; Owner: gaussdb
--

REVOKE ALL ON TABLE category FROM PUBLIC;
REVOKE ALL ON TABLE category FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE category TO gaussdb;
GRANT SELECT ON TABLE category TO db_catalog_reader01;
GRANT SELECT ON TABLE category TO db_catalog_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE category TO db_catalog_librarian01;


--
-- Name: media; Type: ACL; Schema: catalog; Owner: gaussdb
--

REVOKE ALL ON TABLE media FROM PUBLIC;
REVOKE ALL ON TABLE media FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE media TO gaussdb;
GRANT SELECT ON TABLE media TO db_catalog_reader01;
GRANT SELECT ON TABLE media TO db_catalog_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE media TO db_catalog_librarian01;


SET search_path = iam;

--
-- Name: app_role; Type: ACL; Schema: iam; Owner: gaussdb
--

REVOKE ALL ON TABLE app_role FROM PUBLIC;
REVOKE ALL ON TABLE app_role FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE app_role TO gaussdb;
GRANT SELECT,INSERT,UPDATE ON TABLE app_role TO db_iam_runtime;


--
-- Name: app_user; Type: ACL; Schema: iam; Owner: gaussdb
--

REVOKE ALL ON TABLE app_user FROM PUBLIC;
REVOKE ALL ON TABLE app_user FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE app_user TO gaussdb;
GRANT SELECT,INSERT,UPDATE ON TABLE app_user TO db_iam_runtime;


--
-- Name: db_identity_mapping; Type: ACL; Schema: iam; Owner: gaussdb
--

REVOKE ALL ON TABLE db_identity_mapping FROM PUBLIC;
REVOKE ALL ON TABLE db_identity_mapping FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE db_identity_mapping TO gaussdb;
GRANT SELECT,INSERT,UPDATE ON TABLE db_identity_mapping TO db_iam_runtime;


--
-- Name: user_role; Type: ACL; Schema: iam; Owner: gaussdb
--

REVOKE ALL ON TABLE user_role FROM PUBLIC;
REVOKE ALL ON TABLE user_role FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE user_role TO gaussdb;
GRANT SELECT,INSERT,UPDATE ON TABLE user_role TO db_iam_runtime;


SET search_path = loan;

--
-- Name: book_copy; Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON TABLE book_copy FROM PUBLIC;
REVOKE ALL ON TABLE book_copy FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE book_copy TO gaussdb;
GRANT SELECT ON TABLE book_copy TO db_loan_reader01;
GRANT SELECT ON TABLE book_copy TO db_loan_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE book_copy TO db_loan_librarian01;


--
-- Name: book_snapshot; Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON TABLE book_snapshot FROM PUBLIC;
REVOKE ALL ON TABLE book_snapshot FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE book_snapshot TO gaussdb;
GRANT SELECT ON TABLE book_snapshot TO db_loan_reader01;
GRANT SELECT ON TABLE book_snapshot TO db_loan_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE book_snapshot TO db_loan_librarian01;


--
-- Name: borrower_account; Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON TABLE borrower_account FROM PUBLIC;
REVOKE ALL ON TABLE borrower_account FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE borrower_account TO gaussdb;
GRANT SELECT ON TABLE borrower_account TO db_loan_reader01;
GRANT SELECT ON TABLE borrower_account TO db_loan_reader02;
GRANT SELECT,INSERT,UPDATE ON TABLE borrower_account TO db_loan_librarian01;


--
-- Name: loan_audit; Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON TABLE loan_audit FROM PUBLIC;
REVOKE ALL ON TABLE loan_audit FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE loan_audit TO gaussdb;
GRANT SELECT ON TABLE loan_audit TO db_loan_reader01;
GRANT SELECT ON TABLE loan_audit TO db_loan_reader02;
GRANT SELECT ON TABLE loan_audit TO db_loan_librarian01;


--
-- Name: loan_record; Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON TABLE loan_record FROM PUBLIC;
REVOKE ALL ON TABLE loan_record FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE loan_record TO gaussdb;
GRANT SELECT ON TABLE loan_record TO db_loan_reader01;
GRANT SELECT ON TABLE loan_record TO db_loan_reader02;
GRANT SELECT ON TABLE loan_record TO db_loan_librarian01;


--
-- Name: request_dedup; Type: ACL; Schema: loan; Owner: gaussdb
--

REVOKE ALL ON TABLE request_dedup FROM PUBLIC;
REVOKE ALL ON TABLE request_dedup FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE request_dedup TO gaussdb;
GRANT SELECT ON TABLE request_dedup TO db_loan_reader01;
GRANT SELECT ON TABLE request_dedup TO db_loan_reader02;
GRANT SELECT ON TABLE request_dedup TO db_loan_librarian01;


SET search_path = report;

--
-- Name: book_dim; Type: ACL; Schema: report; Owner: gaussdb
--

REVOKE ALL ON TABLE book_dim FROM PUBLIC;
REVOKE ALL ON TABLE book_dim FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE book_dim TO gaussdb;
GRANT SELECT ON TABLE book_dim TO db_report_analyst01;
GRANT SELECT,INSERT,UPDATE ON TABLE book_dim TO db_report_sync;


--
-- Name: category_dim; Type: ACL; Schema: report; Owner: gaussdb
--

REVOKE ALL ON TABLE category_dim FROM PUBLIC;
REVOKE ALL ON TABLE category_dim FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE category_dim TO gaussdb;
GRANT SELECT ON TABLE category_dim TO db_report_analyst01;
GRANT SELECT,INSERT,UPDATE ON TABLE category_dim TO db_report_sync;


--
-- Name: loan_fact; Type: ACL; Schema: report; Owner: gaussdb
--

REVOKE ALL ON TABLE loan_fact FROM PUBLIC;
REVOKE ALL ON TABLE loan_fact FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE loan_fact TO gaussdb;
GRANT SELECT ON TABLE loan_fact TO db_report_analyst01;
GRANT SELECT,INSERT,UPDATE ON TABLE loan_fact TO db_report_sync;


--
-- Name: reader_dim; Type: ACL; Schema: report; Owner: gaussdb
--

REVOKE ALL ON TABLE reader_dim FROM PUBLIC;
REVOKE ALL ON TABLE reader_dim FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE reader_dim TO gaussdb;
GRANT SELECT ON TABLE reader_dim TO db_report_analyst01;
GRANT SELECT,INSERT,UPDATE ON TABLE reader_dim TO db_report_sync;


--
-- Name: sync_checkpoint; Type: ACL; Schema: report; Owner: gaussdb
--

REVOKE ALL ON TABLE sync_checkpoint FROM PUBLIC;
REVOKE ALL ON TABLE sync_checkpoint FROM gaussdb;
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,UPDATE ON TABLE sync_checkpoint TO gaussdb;
GRANT SELECT,INSERT,UPDATE ON TABLE sync_checkpoint TO db_report_sync;


--
-- openGauss database dump complete
--

