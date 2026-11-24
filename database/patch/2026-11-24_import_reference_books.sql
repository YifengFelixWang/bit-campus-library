-- 导入「减重类 / 主参考书」：5 本电子书入库并挂上原文件
--
-- 19 是用户在控制台手工加的（书名带着 z-library 后缀、ISBN 写成字符串 null、作者也是 null），
-- 这里一并订正；20–23 是新增。ISBN 按用户要求留空（内部资料、影印本常常没有正式 ISBN）。
-- 副本沿用馆内条码规则；文件已由后台传到 /opt/library-files/incoming/，本脚本只登记元数据，
-- 文件名与落盘由 deploy 步骤的 rename 完成。

BEGIN;

-- openGauss 在 A 兼容模式下把空串当 NULL，而 isbn 原本 NOT NULL，
-- 所以「ISBN 可以留空」的前提是先把这一列放开。
ALTER TABLE catalog.book ALTER COLUMN isbn DROP NOT NULL;
-- 借阅侧快照镜像书目的 ISBN，同样要允许为空
ALTER TABLE loan.book_snapshot ALTER COLUMN isbn DROP NOT NULL;

-- ---------- 订正 19 ----------
UPDATE catalog.book SET
       title = '健身营养全书：关于力量与肌肉的营养策略',
       isbn = NULL, publisher = '北京科学技术出版社', publish_year = 2018,
       category_id = 3, total_copies = 2, updated_at = localtimestamp
 WHERE book_id = 19;

UPDATE catalog.author SET author_name = '克里斯蒂安·冯·勒费尔霍尔茨', updated_at = localtimestamp
 WHERE author_id = 9;

-- ---------- 新增 20–23 ----------
INSERT INTO catalog.book(book_id, isbn, title, category_id, publisher, publish_year, summary, total_copies, updated_at, deleted)
SELECT 20, NULL, 'Exercise Physiology: Foundations of Exercise Science', 3, NULL, 2019,
       '运动生理学教材，讲运动时心肺、代谢与肌肉的适应。', 1, localtimestamp, FALSE
 WHERE NOT EXISTS (SELECT 1 FROM catalog.book WHERE book_id = 20);

INSERT INTO catalog.book(book_id, isbn, title, category_id, publisher, publish_year, summary, total_copies, updated_at, deleted)
SELECT 21, NULL, 'Sport Nutrition for Health and Performance', 3, NULL, 2009,
       '运动营养学教材，覆盖能量代谢、宏量营养素与运动表现。', 1, localtimestamp, FALSE
 WHERE NOT EXISTS (SELECT 1 FROM catalog.book WHERE book_id = 21);

INSERT INTO catalog.book(book_id, isbn, title, category_id, publisher, publish_year, summary, total_copies, updated_at, deleted)
SELECT 22, NULL, '中国食物成分表 标准版 第6版 第一册（植物性食物）', 3, NULL, 2018,
       '中国疾病预防控制中心营养与健康所编，植物性食物的成分数据。', 1, localtimestamp, FALSE
 WHERE NOT EXISTS (SELECT 1 FROM catalog.book WHERE book_id = 22);

INSERT INTO catalog.book(book_id, isbn, title, category_id, publisher, publish_year, summary, total_copies, updated_at, deleted)
SELECT 23, NULL, '中国食物成分表 标准版 第6版 第二册', 3, NULL, 2019,
       '中国食物成分表第二册，动物性食物与调味品等成分数据。', 1, localtimestamp, FALSE
 WHERE NOT EXISTS (SELECT 1 FROM catalog.book WHERE book_id = 23);

-- ---------- 作者 ----------
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 10, 'John P. Porcari', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 10);
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 11, 'Cedric X. Bryant', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 11);
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 12, 'Melinda Manore', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 12);
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 13, 'Nanna Meyer', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 13);
INSERT INTO catalog.author(author_id, author_name, updated_at, deleted)
SELECT 14, '中国疾病预防控制中心营养与健康所', localtimestamp, FALSE WHERE NOT EXISTS (SELECT 1 FROM catalog.author WHERE author_id = 14);

INSERT INTO catalog.book_author(book_id, author_id)
SELECT 20, 10 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 20 AND author_id = 10);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 20, 11 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 20 AND author_id = 11);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 21, 12 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 21 AND author_id = 12);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 21, 13 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 21 AND author_id = 13);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 22, 14 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 22 AND author_id = 14);
INSERT INTO catalog.book_author(book_id, author_id)
SELECT 23, 14 WHERE NOT EXISTS (SELECT 1 FROM catalog.book_author WHERE book_id = 23 AND author_id = 14);

-- ---------- 副本（19 已有两条 B19-1/B19-2，这里只补 20–23） ----------
INSERT INTO loan.book_copy(copy_id, book_id, barcode, status, updated_at)
SELECT 4418648504829400, 20, 'LIB-0020-01', 'AVAILABLE', localtimestamp
 WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE book_id = 20);
INSERT INTO loan.book_copy(copy_id, book_id, barcode, status, updated_at)
SELECT 4418648504829401, 21, 'LIB-0021-01', 'AVAILABLE', localtimestamp
 WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE book_id = 21);
INSERT INTO loan.book_copy(copy_id, book_id, barcode, status, updated_at)
SELECT 4418648504829402, 22, 'LIB-0022-01', 'AVAILABLE', localtimestamp
 WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE book_id = 22);
INSERT INTO loan.book_copy(copy_id, book_id, barcode, status, updated_at)
SELECT 4418648504829403, 23, 'LIB-0023-01', 'AVAILABLE', localtimestamp
 WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy WHERE book_id = 23);

-- ---------- 借阅侧快照 ----------
INSERT INTO loan.book_snapshot(book_id, title, isbn, updated_at)
SELECT b.book_id, b.title, b.isbn, localtimestamp
  FROM catalog.book b
 WHERE b.book_id IN (19, 20, 21, 22, 23)
   AND NOT EXISTS (SELECT 1 FROM loan.book_snapshot s WHERE s.book_id = b.book_id);

-- ---------- 电子书元数据（文件由部署脚本放到 /opt/library-files） ----------
DELETE FROM catalog.ebook WHERE book_id IN (19, 20, 21, 22, 23);

INSERT INTO catalog.ebook(book_id, file_name, size_bytes, uploaded_by, updated_at, deleted) VALUES
 (19, 'ebook-19.pdf', 10821200, 3, localtimestamp, FALSE),
 (20, 'ebook-20.pdf', 136230687, 3, localtimestamp, FALSE),
 (21, 'ebook-21.pdf', 52372224, 3, localtimestamp, FALSE),
 (22, 'ebook-22.epub', 72992433, 3, localtimestamp, FALSE),
 (23, 'ebook-23.epub', 52767888, 3, localtimestamp, FALSE);

COMMIT;
