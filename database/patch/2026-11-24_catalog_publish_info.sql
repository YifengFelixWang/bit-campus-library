-- 补齐书目的出版信息，并让外文书按原名也能搜到
--
-- 问题：六本书的 ISBN 是 978-7-00000001 这类占位号或 LOCAL-0006，出版社与出版年全为空；
-- 详情页「出版年 / 出版社」永远显示「—」，按年份区间筛选必然 0 条。
-- 外文书只有中文书名，读者按封面上的英文原名（如 Advanced…）搜不到。
--
-- 做法：ISBN 取原书版权页 / 公开版本信息，出版社与出版年按对应版本填写；
-- 外文书书名改成「原名（中文译名）」，两种写法都能命中 ILIKE 检索。
-- 可重复执行。

BEGIN;

UPDATE catalog.book SET isbn = '9787020002207', publisher = '人民文学出版社', publish_year = 1996,
       updated_at = localtimestamp WHERE book_id = 1;
UPDATE catalog.book SET isbn = '9787506365437', publisher = '作家出版社', publish_year = 2012,
       updated_at = localtimestamp WHERE book_id = 2;
UPDATE catalog.book SET isbn = '9787020024759', publisher = '人民文学出版社', publish_year = 1991,
       updated_at = localtimestamp WHERE book_id = 3;
UPDATE catalog.book SET isbn = '9787111375296', publisher = '机械工业出版社', publish_year = 2012,
       updated_at = localtimestamp WHERE book_id = 4;

-- 原书版权页：Pearson 第 3 版 / Cengage 第 7 版
UPDATE catalog.book SET
       title = 'Computer Systems: A Programmer''s Perspective（深入理解计算机系统）',
       isbn = '9780134092669', publisher = 'Pearson', publish_year = 2016,
       updated_at = localtimestamp
 WHERE book_id = 6;
UPDATE catalog.book SET
       title = 'Advanced Nutrition and Human Metabolism（高等营养全书）',
       isbn = '9781305627857', publisher = 'Cengage Learning', publish_year = 2017,
       updated_at = localtimestamp
 WHERE book_id = 18;

-- 借阅侧快照与报表维度都存了书名副本，跟着主表一起改，避免三个地方名字不一致
UPDATE loan.book_snapshot s
   SET title = b.title, isbn = b.isbn, updated_at = localtimestamp
  FROM catalog.book b
 WHERE s.book_id = b.book_id AND (s.title <> b.title OR s.isbn <> b.isbn);

UPDATE report.book_dim d
   SET title = b.title, isbn = b.isbn, source_updated_at = localtimestamp
  FROM catalog.book b
 WHERE d.book_id = b.book_id AND (d.title <> b.title OR d.isbn <> b.isbn);

COMMIT;
