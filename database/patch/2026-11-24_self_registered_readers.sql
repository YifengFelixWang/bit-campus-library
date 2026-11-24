-- 自助注册读者的数据库身份
--
-- 背景：借阅服务原来只认 reader01 / reader02 / librarian01 三个库角色，
-- 新注册的读者在库这一层没有身份，于是 /api/me、/api/copies、/api/loans 全部 403。
--
-- 做法：不按人建库角色（一个注册用户一个 role 既难运维，也会把"九个角色"的授权模型冲掉），
-- 而是给自助读者一个共享的最小权限角色 db_loan_selfreader；
-- 具体是谁由应用在事务里通过 library.reader_id 传进来，actor_id() 负责校验。
--
-- 执行：python3 运行同目录 deploy_self_registered_readers.py（会替换口令占位符）

-- 1) 共享只读登录角色（口令由部署脚本注入）
CREATE USER db_loan_selfreader WITH PASSWORD ':selfreader_password' NOSYSADMIN;

GRANT USAGE ON SCHEMA loan TO db_loan_selfreader;
GRANT SELECT ON TABLE loan.book_copy TO db_loan_selfreader;
GRANT SELECT ON TABLE loan.book_snapshot TO db_loan_selfreader;
GRANT SELECT ON TABLE loan.borrower_account TO db_loan_selfreader;
GRANT SELECT ON TABLE loan.loan_audit TO db_loan_selfreader;
GRANT SELECT ON TABLE loan.loan_record TO db_loan_selfreader;
GRANT SELECT ON TABLE loan.request_dedup TO db_loan_selfreader;
GRANT EXECUTE ON PROCEDURE loan.sp_borrow_copy(p_user bigint, p_copy bigint, p_days integer, p_request varchar, p_new_loan bigint) TO db_loan_selfreader;
GRANT EXECUTE ON PROCEDURE loan.sp_return_copy(p_loan bigint, p_request varchar) TO db_loan_selfreader;

-- 2) actor_id() 增加共享角色的分支
--    session_user 仍然是数据库校验的第一道门：只有 db_loan_selfreader 才读会话变量，
--    其他角色读不到也用不了，避免应用随便传一个 id 就冒充别人。
CREATE OR REPLACE FUNCTION loan.actor_id() RETURNS bigint
    LANGUAGE plpgsql NOT SHIPPABLE
AS $function$
DECLARE
    v text;
BEGIN
    CASE session_user
    WHEN 'db_loan_reader01' THEN RETURN 1;
    WHEN 'db_loan_reader02' THEN RETURN 2;
    WHEN 'db_loan_librarian01' THEN RETURN 3;
    WHEN 'db_loan_selfreader' THEN
        -- openGauss 没有 current_setting(name, missing_ok) 两参数版本，
        -- 参数未设置时会直接报错，所以用异常块兜住，等价于取不到就按未设置处理。
        BEGIN
            v := current_setting('library.reader_id');
        EXCEPTION WHEN others THEN
            v := NULL;
        END;
        IF v IS NULL OR v = '' THEN
            RAISE EXCEPTION 'FORBIDDEN';
        END IF;
        RETURN v::bigint;
    ELSE
        RAISE EXCEPTION 'FORBIDDEN';
    END CASE;
END;
$function$;

-- 3) 首次访问时补借阅人档案：自助读者没有种子数据，不建这行就借不了书
CREATE OR REPLACE FUNCTION loan.fn_ensure_borrower(p_user bigint, p_limit integer DEFAULT 5)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER NOT SHIPPABLE
    SET search_path = loan, pg_catalog
AS $function$
BEGIN
    IF p_user IS NULL OR p_user <= 0 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT';
    END IF;
    INSERT INTO loan.borrower_account(user_id, max_loan_count, active, updated_at)
    SELECT p_user, p_limit, TRUE, clock_timestamp()
    WHERE NOT EXISTS (SELECT 1 FROM loan.borrower_account WHERE user_id = p_user);
END;
$function$;

-- 过程以 SECURITY DEFINER 调用 actor_id()，共享角色本身不需要它；
-- 授出来是为了能直接用 gsql 验证"这个角色看到的是谁"，排障时省一步。
GRANT EXECUTE ON FUNCTION loan.actor_id() TO db_loan_selfreader;
GRANT EXECUTE ON FUNCTION loan.fn_ensure_borrower(bigint, integer) TO db_loan_selfreader;
GRANT EXECUTE ON FUNCTION loan.fn_ensure_borrower(bigint, integer) TO db_loan_reader01;
GRANT EXECUTE ON FUNCTION loan.fn_ensure_borrower(bigint, integer) TO db_loan_reader02;
GRANT EXECUTE ON FUNCTION loan.fn_ensure_borrower(bigint, integer) TO db_loan_librarian01;
