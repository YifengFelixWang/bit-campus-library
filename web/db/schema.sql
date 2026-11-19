-- B 早期原型参考，当前 openGauss 建库入口见仓库 database/opengauss/README.md。
-- BIT BOOKS · Library Borrowing Management System
-- Target: GaussDB / openGauss (PostgreSQL-compatible syntax)
-- Usage:
--   gsql -d postgres -f schema.sql
--   gsql -d tata_books -f schema.sql
-- Demo passwords:
--   admin / admin123, librarian / lib123, reader / read123
--   MD5 is used only to satisfy the course requirement. Use bcrypt/Argon2 in production.

CREATE DATABASE tata_books WITH ENCODING 'UTF8' DBCOMPATIBILITY 'PG';
\connect tata_books

CREATE SCHEMA IF NOT EXISTS public;
SET search_path TO public;

CREATE TABLE roles (
  role_code   VARCHAR(32) PRIMARY KEY,
  name        VARCHAR(64) NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE users (
  user_id       VARCHAR(16) PRIMARY KEY,
  username      VARCHAR(32) NOT NULL UNIQUE,
  password_md5  CHAR(32) NOT NULL,
  name          VARCHAR(64) NOT NULL,
  role_code     VARCHAR(32) NOT NULL REFERENCES roles(role_code),
  status        VARCHAR(16) NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'disabled')),
  email         VARCHAR(128),
  phone         VARCHAR(32),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login    TIMESTAMPTZ
);

CREATE TABLE categories (
  category_id VARCHAR(16) PRIMARY KEY,
  name        VARCHAR(64) NOT NULL UNIQUE,
  sort        INT NOT NULL DEFAULT 0
);

CREATE TABLE books (
  book_id       VARCHAR(32) PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  author        VARCHAR(120) NOT NULL,
  category      VARCHAR(64) NOT NULL REFERENCES categories(name) ON UPDATE CASCADE,
  isbn          VARCHAR(40),
  publisher     VARCHAR(120),
  publish_year  INT,
  total         INT NOT NULL CHECK (total > 0),
  available     INT NOT NULL CHECK (available >= 0),
  shelf_status  VARCHAR(16) NOT NULL DEFAULT 'on_shelf'
                CHECK (shelf_status IN ('on_shelf', 'warehouse', 'off_shelf')),
  rating        NUMERIC(2,1) NOT NULL DEFAULT 4.5 CHECK (rating BETWEEN 0 AND 5),
  borrow_count  INT NOT NULL DEFAULT 0 CHECK (borrow_count >= 0),
  cover_blob    BYTEA,
  cover_mime    VARCHAR(64) NOT NULL DEFAULT 'image/png',
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT books_stock_valid CHECK (available <= total)
);

CREATE TABLE borrows (
  borrow_id   VARCHAR(20) PRIMARY KEY,
  user_id     VARCHAR(16) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  book_id     VARCHAR(32) NOT NULL REFERENCES books(book_id) ON DELETE RESTRICT,
  borrowed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at      TIMESTAMPTZ NOT NULL,
  returned_at TIMESTAMPTZ,
  status      VARCHAR(16) NOT NULL DEFAULT 'borrowing'
              CHECK (status IN ('borrowing', 'returned', 'overdue')),
  renew_count INT NOT NULL DEFAULT 0,
  operator    VARCHAR(32) NOT NULL DEFAULT 'tata_app',
  CONSTRAINT borrow_due_valid CHECK (due_at > borrowed_at)
);

CREATE TABLE reviews (
  review_id   VARCHAR(20) PRIMARY KEY,
  book_id     VARCHAR(32) NOT NULL REFERENCES books(book_id) ON DELETE CASCADE,
  user_id     VARCHAR(16) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content     VARCHAR(500),
  type        VARCHAR(16) NOT NULL DEFAULT 'review'
              CHECK (type IN ('review', 'feedback')),
  status      VARCHAR(16) NOT NULL DEFAULT 'visible'
              CHECK (status IN ('visible', 'hidden')),
  reply       TEXT,
  replied_at  TIMESTAMPTZ,
  replied_by  VARCHAR(32),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (book_id, user_id, type)
);

CREATE TABLE announcements (
  announcement_id VARCHAR(20) PRIMARY KEY,
  title           VARCHAR(80) NOT NULL,
  content         TEXT NOT NULL,
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  status          VARCHAR(16) NOT NULL DEFAULT 'published'
                  CHECK (status IN ('published', 'draft')),
  author          VARCHAR(32) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reviews_book        ON reviews(book_id, status, created_at DESC);
CREATE INDEX idx_reviews_user        ON reviews(user_id, created_at DESC);
CREATE INDEX idx_announcements_pub   ON announcements(status, pinned DESC, updated_at DESC);

CREATE TABLE audit_logs (
  log_id  BIGSERIAL,
  ts      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor   VARCHAR(64) NOT NULL DEFAULT 'system',
  action  VARCHAR(64) NOT NULL,
  detail  TEXT,
  level   VARCHAR(16) NOT NULL DEFAULT 'info'
          CHECK (level IN ('info', 'success', 'warn', 'error', 'trigger')),
  node    VARCHAR(32) NOT NULL DEFAULT 'node-a',
  PRIMARY KEY (log_id, ts)
) PARTITION BY RANGE (ts);

CREATE TABLE audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');

CREATE TABLE db_accounts (
  db_user     VARCHAR(64) PRIMARY KEY,
  type        VARCHAR(64) NOT NULL,
  auth_type   VARCHAR(64) NOT NULL,
  privileges  TEXT NOT NULL,
  status      VARCHAR(16) NOT NULL DEFAULT 'online',
  last_login  TIMESTAMPTZ
);

CREATE TABLE backups (
  backup_id VARCHAR(64) PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type      VARCHAR(16) NOT NULL DEFAULT 'full',
  size      BIGINT NOT NULL DEFAULT 0,
  node      VARCHAR(32) NOT NULL DEFAULT 'node-a',
  status    VARCHAR(16) NOT NULL DEFAULT 'success',
  note      TEXT,
  snapshot  JSONB
);

CREATE INDEX idx_books_category           ON books(category, available);
CREATE INDEX idx_books_shelf              ON books(shelf_status, available);
CREATE INDEX idx_books_hot                ON books(borrow_count DESC, rating DESC);
CREATE INDEX idx_borrows_user_status      ON borrows(user_id, status);
CREATE INDEX idx_borrows_book_recent      ON borrows(book_id, borrowed_at DESC);
CREATE INDEX idx_borrows_due              ON borrows(due_at) WHERE status <> 'returned';
CREATE INDEX idx_audit_ts                 ON audit_logs(ts DESC);
CREATE INDEX idx_audit_level              ON audit_logs(level);

CREATE OR REPLACE VIEW v_borrow_detail AS
SELECT br.borrow_id,
       u.user_id,
       u.name AS user_name,
       u.username,
       b.book_id,
       b.title AS book_title,
       b.author,
       b.category,
       br.borrowed_at,
       br.due_at,
       br.returned_at,
       br.status
FROM borrows br
JOIN users u ON u.user_id = br.user_id
JOIN books b ON b.book_id = br.book_id;

CREATE OR REPLACE VIEW v_hot_books AS
SELECT b.book_id,
       b.title,
       c.name AS category,
       b.borrow_count,
       COUNT(br.borrow_id) FILTER (WHERE br.borrowed_at >= CURRENT_DATE - INTERVAL '30 days') AS recent_count,
       b.rating,
       b.available,
       b.total
FROM books b
JOIN categories c ON c.name = b.category
LEFT JOIN borrows br ON br.book_id = b.book_id
GROUP BY b.book_id, b.title, c.name, b.borrow_count, b.rating, b.available, b.total;

CREATE OR REPLACE FUNCTION fn_validate_borrow() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE v_active INT;
BEGIN
  IF NEW.due_at <= NEW.borrowed_at THEN
    RAISE EXCEPTION '到期日必须晚于借出日';
  END IF;

  SELECT COUNT(*) INTO v_active
  FROM borrows
  WHERE user_id = NEW.user_id AND status <> 'returned';

  IF v_active >= 5 THEN
    RAISE EXCEPTION '每位读者最多同时借阅 5 本';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_borrow
BEFORE INSERT ON borrows
FOR EACH ROW EXECUTE PROCEDURE fn_validate_borrow();

CREATE OR REPLACE FUNCTION fn_after_borrow() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE books
  SET available = available - 1,
      borrow_count = borrow_count + 1
  WHERE book_id = NEW.book_id AND available > 0;

  IF NOT FOUND THEN
    RAISE EXCEPTION '库存不足，触发器回滚借阅事务';
  END IF;

  INSERT INTO audit_logs(actor, action, detail, level)
  VALUES (NEW.operator, 'TRG_AFTER_BORROW_INSERT',
          '库存扣减: ' || NEW.book_id || ', 借阅号: ' || NEW.borrow_id, 'trigger');

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_after_borrow
AFTER INSERT ON borrows
FOR EACH ROW EXECUTE PROCEDURE fn_after_borrow();

CREATE OR REPLACE FUNCTION fn_after_return() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'returned' AND OLD.status <> 'returned' THEN
    UPDATE books
    SET available = LEAST(total, available + 1)
    WHERE book_id = NEW.book_id;

    INSERT INTO audit_logs(actor, action, detail, level)
    VALUES (NEW.operator, 'TRG_AFTER_RETURN_UPDATE',
            '库存恢复: ' || NEW.book_id || ', 借阅号: ' || NEW.borrow_id, 'trigger');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_after_return
AFTER UPDATE ON borrows
FOR EACH ROW EXECUTE PROCEDURE fn_after_return();

CREATE OR REPLACE PROCEDURE sp_borrow_book(p_user_id VARCHAR, p_book_id VARCHAR)
LANGUAGE plpgsql AS $$
DECLARE
  v_active INT;
  v_stock  INT;
  v_status VARCHAR;
  v_due    TIMESTAMPTZ := NOW() + INTERVAL '30 days';
  v_id     VARCHAR(20);
BEGIN
  SELECT status INTO v_status FROM users WHERE user_id = p_user_id;
  IF v_status IS NULL OR v_status <> 'active' THEN
    RAISE EXCEPTION '读者不存在或已被停用';
  END IF;

  SELECT COUNT(*) INTO v_active
  FROM borrows
  WHERE user_id = p_user_id AND status <> 'returned';

  IF v_active >= 5 THEN
    RAISE EXCEPTION '每位读者最多同时借阅 5 本';
  END IF;

  IF EXISTS (
    SELECT 1 FROM borrows
    WHERE user_id = p_user_id AND book_id = p_book_id AND status <> 'returned'
  ) THEN
    RAISE EXCEPTION '该图书已在借阅中';
  END IF;

  SELECT available INTO v_stock
  FROM books
  WHERE book_id = p_book_id
  FOR UPDATE;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION '图书不存在';
  END IF;
  IF v_stock <= 0 THEN
    RAISE EXCEPTION '库存不足';
  END IF;

  v_id := 'BR' || LPAD((SELECT COUNT(*) + 1 FROM borrows)::TEXT, 4, '0');

  INSERT INTO borrows(borrow_id, user_id, book_id, borrowed_at, due_at, status, operator)
  VALUES (v_id, p_user_id, p_book_id, NOW(), v_due, 'borrowing', 'tata_app');

  INSERT INTO audit_logs(actor, action, detail, level)
  VALUES ('tata_app', 'CALL sp_borrow_book',
          'user=' || p_user_id || ', book=' || p_book_id || ', borrow=' || v_id, 'info');
END;
$$;

CREATE OR REPLACE PROCEDURE sp_return_book(p_borrow_id VARCHAR)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE borrows
  SET status = 'returned', returned_at = NOW()
  WHERE borrow_id = p_borrow_id AND status <> 'returned';

  IF NOT FOUND THEN
    RAISE EXCEPTION '借阅记录不存在或已归还';
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE sp_overdue_check()
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE borrows
  SET status = 'overdue'
  WHERE status = 'borrowing' AND due_at < NOW();

  INSERT INTO audit_logs(actor, action, detail, level)
  VALUES ('tata_app', 'CALL sp_overdue_check', '逾期扫描完成', 'warn');
END;
$$;

CREATE OR REPLACE FUNCTION sp_hot_books(p_limit INT DEFAULT 10)
RETURNS TABLE(book_id VARCHAR, title VARCHAR, category VARCHAR, recent BIGINT, rating NUMERIC)
LANGUAGE sql AS $$
  SELECT b.book_id, b.title, c.name,
         COUNT(br.borrow_id) AS recent,
         b.rating
  FROM books b
  JOIN categories c ON c.name = b.category
  LEFT JOIN borrows br ON br.book_id = b.book_id
       AND br.borrowed_at >= CURRENT_DATE - INTERVAL '30 days'
  GROUP BY b.book_id, b.title, c.name, b.rating, b.borrow_count
  ORDER BY recent DESC, b.borrow_count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION sp_user_summary(p_user_id VARCHAR)
RETURNS TABLE(total BIGINT, active BIGINT, overdue BIGINT)
LANGUAGE sql AS $$
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE status <> 'returned'),
         COUNT(*) FILTER (WHERE due_at < NOW() AND status <> 'returned')
  FROM borrows
  WHERE user_id = p_user_id;
$$;

-- Seed roles and demo users (MD5 hashes match admin123 / lib123 / read123).
INSERT INTO roles(role_code, name, description, permissions) VALUES
('admin', '系统管理员', '全部业务与运维权限', '["*"]'::jsonb),
('librarian', '图书管理员', '图书、借阅、评价、公告；查看用户并编辑本人/读者资料、批量注册读者', '["book:read","book:write","borrow:self","borrow:read","borrow:manage","review:manage","announcement:write","user:read","user:edit","user:import","db:query","db:proc","data:export","data:import","audit:read"]'::jsonb),
('reader', '读者', '浏览、借阅、归还与评价', '["book:read","borrow:self","rating:write","review:read","announcement:read","pdf:read"]'::jsonb),
('guest', '访客', '浏览图书、详情与公告', '["book:read","book:detail","review:read","announcement:read"]'::jsonb);

INSERT INTO users(user_id, username, password_md5, name, role_code, email, phone) VALUES
('U001', 'admin', '0192023a7bbd73250516f069df18b500', '系统管理员', 'admin', 'admin@tata.books', '138-0000-0001'),
('U002', 'librarian', '152ed960b613b67008ca54c756b4ced0', '周晓岚', 'librarian', 'zhouxl@tata.books', '138-0000-0002'),
('U003', 'reader', '25bab5d8386065dbcaebde4d49aa2193', '林小满', 'reader', 'linxm@stu.edu.cn', '138-0000-0003');

INSERT INTO categories(category_id, name, sort) VALUES
('C01', '科幻', 1), ('C02', '文学', 2), ('C03', '历史', 3),
('C04', '科技', 4), ('C05', '商业', 5), ('C06', '心理', 6);

INSERT INTO books(book_id, title, author, category, isbn, publisher, publish_year, total, available, rating, borrow_count) VALUES
('b-santi', '三体', '刘慈欣', '科幻', '978-7-5366-9293-0', '重庆出版社', 2008, 6, 6, 4.9, 328),
('b-huozhe', '活着', '余华', '文学', '978-7-5063-6543-7', '作家出版社', 2012, 5, 5, 4.8, 296),
('b-bainian', '百年孤独', '加西亚·马尔克斯', '文学', '978-7-5442-5399-4', '南海出版公司', 2011, 4, 4, 4.7, 271),
('b-renleijianshi', '人类简史', '尤瓦尔·赫拉利', '历史', '978-7-5086-4424-4', '中信出版社', 2014, 5, 5, 4.6, 254),
('b-suanfa', '算法导论', 'Thomas H. Cormen', '科技', '978-7-111-40701-0', '机械工业出版社', 2013, 3, 3, 4.7, 239),
('b-csapp', '深入理解计算机系统', 'Randal E. Bryant', '科技', '978-7-111-54493-7', '机械工业出版社', 2016, 4, 4, 4.8, 226),
('b-qiongchali', '穷查理宝典', '查理·芒格', '商业', '978-7-5086-9356-2', '中信出版社', 2018, 3, 3, 4.6, 198),
('b-yuanze', '原则', '瑞·达利欧', '商业', '978-7-5086-8403-5', '中信出版社', 2018, 4, 4, 4.5, 187),
('b-beitaoyan', '被讨厌的勇气', '岸见一郎', '心理', '978-7-111-49541-8', '机械工业出版社', 2015, 5, 5, 4.6, 176),
('b-sikao', '思考，快与慢', '丹尼尔·卡尼曼', '心理', '978-7-5086-3312-9', '中信出版社', 2012, 3, 3, 4.5, 165),
('b-wanli', '万历十五年', '黄仁宇', '历史', '978-7-1010-5008-5', '中华书局', 2007, 4, 4, 4.7, 152),
('b-yueliang', '月亮与六便士', '毛姆', '文学', '978-7-5339-3564-2', '浙江文艺出版社', 2017, 4, 4, 4.3, 143);

INSERT INTO db_accounts(db_user, type, auth_type, privileges, status, last_login) VALUES
('gauss_dba', '数据库管理员', 'IAM 联邦认证', 'ALL PRIVILEGES', 'online', NOW()),
('tata_app', '应用连接账户', '密码 + IAM', 'SELECT/INSERT/UPDATE/DELETE/EXECUTE', 'online', NOW()),
('tata_readonly', '报表只读账户', 'IAM 联邦认证', 'SELECT', 'online', NOW()),
('tata_backup', '备份运维账户', '密码 + 双因子', 'BACKUP/RESTORE', 'online', NOW()),
('tata_audit', '安全审计账户', 'IAM 联邦认证', 'SELECT(audit_logs)', 'online', NOW());

-- Database accounts (adjust password delivery to IAM policy).
-- 原型账户示例已省略。集成工程从 database/opengauss/init_roles.py 创建运行角色。
-- 原型账户示例已省略。集成工程从 database/opengauss/init_roles.py 创建运行角色。
-- 原型账户示例已省略。集成工程从 database/opengauss/init_roles.py 创建运行角色。
-- 原型账户示例已省略。集成工程从 database/opengauss/init_roles.py 创建运行角色。

GRANT CONNECT ON DATABASE tata_books TO tata_app, tata_readonly, tata_backup, tata_audit;
GRANT USAGE ON SCHEMA public TO tata_app, tata_readonly, tata_backup, tata_audit;
GRANT SELECT, INSERT, UPDATE, DELETE ON books, borrows, users TO tata_app;
GRANT SELECT ON categories, roles, db_accounts TO tata_app;
GRANT INSERT ON audit_logs TO tata_app;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_log_id_seq TO tata_app;
GRANT EXECUTE ON FUNCTION sp_hot_books(INT) TO tata_app;
GRANT EXECUTE ON FUNCTION sp_user_summary(VARCHAR) TO tata_app;
GRANT EXECUTE ON PROCEDURE sp_borrow_book(VARCHAR, VARCHAR) TO tata_app;
GRANT EXECUTE ON PROCEDURE sp_return_book(VARCHAR) TO tata_app;
GRANT EXECUTE ON PROCEDURE sp_overdue_check() TO tata_app;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO tata_readonly;
GRANT SELECT ON audit_logs TO tata_audit;
REVOKE DELETE, UPDATE, TRUNCATE ON audit_logs FROM tata_app;

-- Primary/standby (run on the database hosts, not inside the application schema).
-- Primary postgresql.conf:
--   wal_level = logical
--   max_wal_senders = 8
--   synchronous_standby_names = 'ANY 1 (node_b)'
--   hot_standby = on
-- Standby recovery:
--   gs_ctl build -D /data/gaussdb/node_b
-- Failover / switchover:
--   gs_ctl failover -D /data/gaussdb/node_b
--   gs_ctl switchover -D /data/gaussdb/node_a
-- Application connection string:
--   jdbc:postgresql://10.0.1.11:8000,10.0.1.12:8000/tata_books?target_session_attrs=read-write

-- Backup and restore (server side, executed by the backend).
--   gs_dump -Fc -f /backup/tata_books_$(date +%Y%m%d).dump tata_books
--   gs_restore -d tata_books /backup/tata_books_20261114.dump
--   pg_basebackup -D /backup/base -h 10.0.1.11 -p 8000 -U tata_backup -Ft -z -P

-- Physical maintenance / reorganization.
--   VACUUM (ANALYZE, VERBOSE) books;
--   VACUUM FULL books;
--   REINDEX INDEX idx_borrows_book_recent;
--   ALTER TABLE audit_logs ADD PARTITION audit_logs_2027_01
--     FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
