-- 让已有的两本原版 PDF 直接成为电子书
--
-- 这两本书当初是连着原文件一起导入的（/opt/library-files/book-6.pdf、book-18.pdf），
-- 只是 ebook 表还没有登记。这里补登记，读者立刻可以下载；其余书由馆员在控制台上传。

BEGIN;

INSERT INTO catalog.ebook(book_id, file_name, size_bytes, uploaded_by, updated_at, deleted)
SELECT 6, 'book-6.pdf', 6807346, 3, localtimestamp, FALSE
 WHERE NOT EXISTS (SELECT 1 FROM catalog.ebook WHERE book_id = 6);

INSERT INTO catalog.ebook(book_id, file_name, size_bytes, uploaded_by, updated_at, deleted)
SELECT 18, 'book-18.pdf', 26580000, 3, localtimestamp, FALSE
 WHERE NOT EXISTS (SELECT 1 FROM catalog.ebook WHERE book_id = 18);

COMMIT;
