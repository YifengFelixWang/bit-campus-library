-- 补齐借阅侧的书目快照
--
-- loan.book_snapshot 是借阅模块对书目的只读副本（跨 schema 不建外键，只存快照）。
-- 通过馆员 CSV 导入或控制台补登副本时，catalog 服务会调 loan 的 /api/book-snapshots 写这一行；
-- 而 2026-11-24 这批藏书是直接用 SQL 灌进 catalog 的，绕过了服务层，于是新书借不出去：
-- sp_borrow_copy 会抛 BOOK_SNAPSHOT_MISSING（前端表现为 409）。
--
-- 这个脚本可重复执行，按"缺哪本补哪本"补齐，不改动已有快照。

INSERT INTO loan.book_snapshot(book_id, title, isbn, updated_at)
SELECT b.book_id, b.title, COALESCE(b.isbn, ''), LOCALTIMESTAMP
FROM catalog.book b
WHERE NOT EXISTS (SELECT 1 FROM loan.book_snapshot s WHERE s.book_id = b.book_id)
  AND b.deleted = FALSE;
