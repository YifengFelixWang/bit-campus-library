-- 演示编号，之后不再改。新数据从这些编号之后分配。
-- user 1 reader01 READER
-- user 2 reader02 READER
-- user 3 librarian01 LIBRARIAN
-- user 4 analyst01 ANALYST
-- category 1 文学，category 2 计算机
-- book 1 到 3 属于分类 1，book 4 属于分类 2
-- copy 1 到 4 与 book 1 到 4 一一对应
-- loan 1 到 6，同时包含 BORROWED 和 RETURNED
-- password_hash 为占位文本 REPLACE_WITH_HASH，由 A 换成真实哈希。

DELETE FROM report.loan_fact WHERE loan_id BETWEEN 1 AND 6;
DELETE FROM report.book_dim WHERE book_id BETWEEN 1 AND 4;
DELETE FROM report.reader_dim WHERE user_id BETWEEN 1 AND 2;
DELETE FROM report.category_dim WHERE category_id BETWEEN 1 AND 2;
DELETE FROM report.sync_checkpoint WHERE source_name IN ('iam', 'catalog', 'loan');

DELETE FROM loan.loan_audit WHERE loan_id BETWEEN 1 AND 6;
DELETE FROM loan.loan_record WHERE loan_id BETWEEN 1 AND 6;
DELETE FROM loan.book_copy WHERE copy_id BETWEEN 1 AND 4;
DELETE FROM loan.book_snapshot WHERE book_id BETWEEN 1 AND 4;
DELETE FROM loan.borrower_account WHERE user_id IN (1, 2);

DELETE FROM catalog.media WHERE media_id BETWEEN 1 AND 4;
DELETE FROM catalog.book_author WHERE book_id BETWEEN 1 AND 4;
DELETE FROM catalog.book WHERE book_id BETWEEN 1 AND 4;
DELETE FROM catalog.author WHERE author_id BETWEEN 1 AND 4;
DELETE FROM catalog.category WHERE category_id BETWEEN 1 AND 2;

DELETE FROM iam.db_identity_mapping WHERE user_id BETWEEN 1 AND 4;
DELETE FROM iam.user_role WHERE user_id BETWEEN 1 AND 4;
DELETE FROM iam.app_user WHERE user_id BETWEEN 1 AND 4;
-- Keep shared role rows: accounts created after the demo (e.g. ops1) may reference them.
INSERT INTO iam.app_role (role_id, role_code, role_name)
SELECT seed.role_id, seed.role_code, seed.role_name FROM (VALUES
    (1, 'READER', '读者'),
    (2, 'LIBRARIAN', '馆员'),
    (3, 'ANALYST', '数据分析员'),
    (4, 'OPERATOR', '运维管理员')
) AS seed(role_id, role_code, role_name)
WHERE NOT EXISTS (
    SELECT 1 FROM iam.app_role r WHERE r.role_id = seed.role_id AND r.role_code = seed.role_code
);

INSERT INTO iam.app_user (user_id, username, password_hash, display_name, enabled, updated_at, deleted) VALUES
    (1, 'reader01', 'REPLACE_WITH_HASH', '读者一', TRUE, TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, 'reader02', 'REPLACE_WITH_HASH', '读者二', TRUE, TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (3, 'librarian01', 'REPLACE_WITH_HASH', '馆员一', TRUE, TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (4, 'analyst01', 'REPLACE_WITH_HASH', '分析员一', TRUE, TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO iam.user_role (user_id, role_id) VALUES
    (1, 1),
    (2, 1),
    (3, 2),
    (4, 3);

INSERT INTO iam.db_identity_mapping (user_id, service_code, db_username) VALUES
    (1, 'catalog', 'db_catalog_reader01'),
    (1, 'loan', 'db_loan_reader01'),
    (2, 'catalog', 'db_catalog_reader02'),
    (2, 'loan', 'db_loan_reader02'),
    (3, 'catalog', 'db_catalog_librarian01'),
    (3, 'loan', 'db_loan_librarian01'),
    (4, 'report', 'db_report_analyst01');

INSERT INTO catalog.category (category_id, category_name, updated_at, deleted) VALUES
    (1, '文学', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, '计算机', TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO catalog.book (book_id, isbn, title, category_id, updated_at, deleted) VALUES
    (1, '978-7-00000001', '红楼梦', 1, TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, '978-7-00000002', '活着', 1, TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (3, '978-7-00000003', '围城', 1, TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (4, '978-7-00000004', '数据库系统概念', 2, TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO catalog.author (author_id, author_name, updated_at, deleted) VALUES
    (1, '曹雪芹', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, '余华', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (3, '钱钟书', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (4, 'Abraham Silberschatz', TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO catalog.book_author (book_id, author_id) VALUES
    (1, 1),
    (2, 2),
    (3, 3),
    (4, 4);

INSERT INTO catalog.media (media_id, book_id, file_url, updated_at, deleted) VALUES
    (1, 1, 'covers/book-1.jpg', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, 2, 'covers/book-2.jpg', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (3, 3, 'covers/book-3.jpg', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (4, 4, 'covers/book-4.jpg', TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO loan.borrower_account (user_id, max_loan_count, active, updated_at) VALUES
    (1, 5, TRUE, TIMESTAMP '2026-10-01 09:00:00'),
    (2, 5, TRUE, TIMESTAMP '2026-10-01 09:00:00');

INSERT INTO loan.book_snapshot (book_id, title, isbn, updated_at) VALUES
    (1, '红楼梦', '978-7-00000001', TIMESTAMP '2026-10-01 09:00:00'),
    (2, '活着', '978-7-00000002', TIMESTAMP '2026-10-01 09:00:00'),
    (3, '围城', '978-7-00000003', TIMESTAMP '2026-10-01 09:00:00'),
    (4, '数据库系统概念', '978-7-00000004', TIMESTAMP '2026-10-01 09:00:00');

INSERT INTO loan.book_copy (copy_id, book_id, barcode, status, updated_at) VALUES
    (1, 1, 'BC0001', 'BORROWED', TIMESTAMP '2026-10-01 10:00:00'),
    (2, 2, 'BC0002', 'AVAILABLE', TIMESTAMP '2026-09-20 10:00:00'),
    (3, 3, 'BC0003', 'BORROWED', TIMESTAMP '2026-10-05 10:00:00'),
    (4, 4, 'BC0004', 'AVAILABLE', TIMESTAMP '2026-07-18 10:00:00');

INSERT INTO loan.loan_record (
    loan_id, user_id, copy_id, book_id, status, borrowed_at, due_at, returned_at, updated_at, deleted
) VALUES
    (1, 1, 1, 1, 'BORROWED', TIMESTAMP '2026-10-01 10:00:00', TIMESTAMP '2026-10-31 10:00:00', NULL, TIMESTAMP '2026-10-01 10:00:00', FALSE),
    (2, 1, 2, 2, 'RETURNED', TIMESTAMP '2026-09-01 10:00:00', TIMESTAMP '2026-09-30 10:00:00', TIMESTAMP '2026-09-20 10:00:00', TIMESTAMP '2026-09-20 10:00:00', FALSE),
    (3, 2, 2, 2, 'RETURNED', TIMESTAMP '2026-08-01 10:00:00', TIMESTAMP '2026-08-31 10:00:00', TIMESTAMP '2026-08-15 10:00:00', TIMESTAMP '2026-08-15 10:00:00', FALSE),
    (4, 2, 3, 3, 'BORROWED', TIMESTAMP '2026-10-05 10:00:00', TIMESTAMP '2026-11-05 10:00:00', NULL, TIMESTAMP '2026-10-05 10:00:00', FALSE),
    (5, 1, 4, 4, 'RETURNED', TIMESTAMP '2026-07-01 10:00:00', TIMESTAMP '2026-07-31 10:00:00', TIMESTAMP '2026-07-18 10:00:00', TIMESTAMP '2026-07-18 10:00:00', FALSE),
    (6, 2, 4, 4, 'RETURNED', TIMESTAMP '2026-06-01 10:00:00', TIMESTAMP '2026-06-30 10:00:00', TIMESTAMP '2026-06-20 10:00:00', TIMESTAMP '2026-06-20 10:00:00', FALSE);

INSERT INTO report.category_dim (category_id, category_name, source_updated_at, deleted) VALUES
    (1, '文学', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, '计算机', TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO report.book_dim (book_id, title, isbn, category_id, author_names, source_updated_at, deleted) VALUES
    (1, '红楼梦', '978-7-00000001', 1, '曹雪芹', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, '活着', '978-7-00000002', 1, '余华', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (3, '围城', '978-7-00000003', 1, '钱钟书', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (4, '数据库系统概念', '978-7-00000004', 2, 'Abraham Silberschatz', TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO report.reader_dim (user_id, display_name, role_code, source_updated_at, deleted) VALUES
    (1, '读者一', 'READER', TIMESTAMP '2026-10-01 09:00:00', FALSE),
    (2, '读者二', 'READER', TIMESTAMP '2026-10-01 09:00:00', FALSE);

INSERT INTO report.loan_fact (
    loan_id, user_id, book_id, copy_id, status, borrowed_at, due_at, returned_at, source_updated_at, deleted
) VALUES
    (1, 1, 1, 1, 'BORROWED', TIMESTAMP '2026-10-01 10:00:00', TIMESTAMP '2026-10-31 10:00:00', NULL, TIMESTAMP '2026-10-01 10:00:00', FALSE),
    (2, 1, 2, 2, 'RETURNED', TIMESTAMP '2026-09-01 10:00:00', TIMESTAMP '2026-09-30 10:00:00', TIMESTAMP '2026-09-20 10:00:00', TIMESTAMP '2026-09-20 10:00:00', FALSE),
    (3, 2, 2, 2, 'RETURNED', TIMESTAMP '2026-08-01 10:00:00', TIMESTAMP '2026-08-31 10:00:00', TIMESTAMP '2026-08-15 10:00:00', TIMESTAMP '2026-08-15 10:00:00', FALSE),
    (4, 2, 3, 3, 'BORROWED', TIMESTAMP '2026-10-05 10:00:00', TIMESTAMP '2026-11-05 10:00:00', NULL, TIMESTAMP '2026-10-05 10:00:00', FALSE),
    (5, 1, 4, 4, 'RETURNED', TIMESTAMP '2026-07-01 10:00:00', TIMESTAMP '2026-07-31 10:00:00', TIMESTAMP '2026-07-18 10:00:00', TIMESTAMP '2026-07-18 10:00:00', FALSE),
    (6, 2, 4, 4, 'RETURNED', TIMESTAMP '2026-06-01 10:00:00', TIMESTAMP '2026-06-30 10:00:00', TIMESTAMP '2026-06-20 10:00:00', TIMESTAMP '2026-06-20 10:00:00', FALSE);

INSERT INTO report.sync_checkpoint (source_name, cursor_updated_at, cursor_id, last_success_at, last_error, status) VALUES
    ('iam', NULL, NULL, NULL, NULL, 'SEED'),
    ('catalog', NULL, NULL, NULL, NULL, 'SEED'),
    ('loan', NULL, NULL, NULL, NULL, 'SEED');
