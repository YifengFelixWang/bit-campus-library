-- 给新导入的 5 本参考书补封面与其余元数据
--
-- 封面直接从原文件里取：PDF 渲染第一页，EPUB 读 OPF 里的 cover-image，
-- 压到高 900px、JPEG q85 后放到 web/covers/book-<id>.jpg，
-- 再按现有约定在 catalog.media 里登记（file_url 用 covers/book-<id>.jpg）。
-- 作者按封面版权页补齐（Exercise Physiology 三位、Sport Nutrition 三位、成分表加主编）。
-- 脚本可重复执行。

BEGIN;

INSERT INTO catalog.media(media_id, book_id, file_url, updated_at, deleted)
SELECT 19, 19, 'covers/book-19.jpg', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE media_id = 19);
INSERT INTO catalog.media(media_id, book_id, file_url, updated_at, deleted)
SELECT 20, 20, 'covers/book-20.jpg', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE media_id = 20);
INSERT INTO catalog.media(media_id, book_id, file_url, updated_at, deleted)
SELECT 21, 21, 'covers/book-21.jpg', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE media_id = 21);
INSERT INTO catalog.media(media_id, book_id, file_url, updated_at, deleted)
SELECT 22, 22, 'covers/book-22.jpg', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE media_id = 22);
INSERT INTO catalog.media(media_id, book_id, file_url, updated_at, deleted)
SELECT 23, 23, 'covers/book-23.jpg', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.media WHERE media_id = 23);

INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 15, 'Fabio Comana', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 15);
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 16, 'Janice Thompson', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 16);
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 17, '杨月欣', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 17);

INSERT INTO catalog.book_author(book_id, author_id)
SELECT 20, 15 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 20 AND author_id = 15);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 21, 16 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 21 AND author_id = 16);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 22, 17 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 22 AND author_id = 17);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 23, 17 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 23 AND author_id = 17);

UPDATE catalog.book SET publisher = 'American Council on Exercise', updated_at = localtimestamp WHERE book_id = 20;
UPDATE catalog.book SET publisher = 'Human Kinetics', updated_at = localtimestamp WHERE book_id = 21;
UPDATE catalog.book SET publisher = '北京大学医学出版社', updated_at = localtimestamp WHERE book_id IN (22, 23);

COMMIT;
