-- =============================================================
-- 演示数据扩充：把前端的 14 本书补进 catalog / loan
-- 依据 D 的「06-重建顺序」：新编号从种子之后继续分配
-- 执行者：初始化账户（D）· 仅在 D 的基础演示库执行一次
-- =============================================================

BEGIN;

DO $guard$
BEGIN
    IF EXISTS (SELECT 1 FROM catalog.book WHERE book_id BETWEEN 5 AND 17)
       OR EXISTS (SELECT 1 FROM catalog.author WHERE author_id BETWEEN 5 AND 17)
       OR EXISTS (SELECT 1 FROM catalog.category WHERE category_id BETWEEN 3 AND 7)
       OR EXISTS (SELECT 1 FROM loan.book_snapshot WHERE book_id BETWEEN 5 AND 17)
       OR EXISTS (SELECT 1 FROM loan.book_copy WHERE book_id BETWEEN 5 AND 17 OR copy_id BETWEEN 5 AND 17) THEN
        RAISE EXCEPTION 'B demo IDs already in use. Skip the optional seed on this database.';
    END IF;
END;
$guard$;

-- 1. 新增分类（1 文学、2 计算机 已存在）
INSERT INTO catalog.category (category_id, category_name, updated_at, deleted)
SELECT v.id, v.name, clock_timestamp()::timestamp, FALSE
FROM (VALUES (3,'科幻'), (4,'历史'), (5,'科技'), (6,'商业'), (7,'心理')) AS v(id, name)
WHERE NOT EXISTS (SELECT 1 FROM catalog.category c WHERE c.category_id = v.id);

-- 2. 作者（5 起）
INSERT INTO catalog.author (author_id, author_name, updated_at, deleted)
SELECT v.id, v.name, clock_timestamp()::timestamp, FALSE
FROM (VALUES
  (5,'刘慈欣'), (6,'加西亚·马尔克斯'), (7,'尤瓦尔·赫拉利'),
  (8,'Thomas H. Cormen'), (9,'Randal E. Bryant'), (10,'查理·芒格'),
  (11,'瑞·达利欧'), (12,'岸见一郎'), (13,'丹尼尔·卡尼曼'),
  (14,'黄仁宇'), (15,'毛姆'), (16,'王珊'), (17,'Stuart Russell')
) AS v(id, name)
WHERE NOT EXISTS (SELECT 1 FROM catalog.author a WHERE a.author_id = v.id);

-- 3. 书目（5 起；「活着」已在 book_id=2，不重复插入）
INSERT INTO catalog.book (book_id, isbn, title, category_id, updated_at, deleted, total_copies)
SELECT v.id, v.isbn, v.title, v.cat, clock_timestamp()::timestamp, FALSE, 1
FROM (VALUES
  (5, '978-7-5366-9293-0', '三体',                3),
  (6, '978-7-5442-5399-4', '百年孤独',            1),
  (7, '978-7-5086-4424-4', '人类简史',            4),
  (8, '978-7-111-40701-0', '算法导论',            5),
  (9, '978-7-111-54493-7', '深入理解计算机系统',   5),
  (10,'978-7-5086-9356-2', '穷查理宝典',          6),
  (11,'978-7-5086-8403-5', '原则',                6),
  (12,'978-7-111-49541-8', '被讨厌的勇气',        7),
  (13,'978-7-5086-3312-9', '思考，快与慢',        7),
  (14,'978-7-1010-5008-5', '万历十五年',          4),
  (15,'978-7-5339-3564-2', '月亮与六便士',        1),
  (16,'978-7-04-040664-1', '数据库系统概论',       5),
  (17,'978-7-302-33199-2', '人工智能：一种现代的方法', 5)
) AS v(id, isbn, title, cat)
WHERE NOT EXISTS (SELECT 1 FROM catalog.book b WHERE b.book_id = v.id);

-- 4. 书目-作者关联
INSERT INTO catalog.book_author (book_id, author_id)
SELECT v.book_id, v.author_id
FROM (VALUES
  (5,5), (6,6), (7,7), (8,8), (9,9), (10,10), (11,11),
  (12,12), (13,13), (14,14), (15,15), (16,16), (17,17)
) AS v(book_id, author_id)
WHERE NOT EXISTS (
  SELECT 1 FROM catalog.book_author ba
  WHERE ba.book_id = v.book_id AND ba.author_id = v.author_id
);

-- 5. 副本：每本 1 册，全部可借（C 的 loan schema）
INSERT INTO loan.book_copy (copy_id, book_id, barcode, status, updated_at)
SELECT v.copy_id, v.book_id, v.barcode, 'AVAILABLE', clock_timestamp()::timestamp
FROM (VALUES
  (5,5,'BC0005'), (6,6,'BC0006'), (7,7,'BC0007'), (8,8,'BC0008'),
  (9,9,'BC0009'), (10,10,'BC0010'), (11,11,'BC0011'), (12,12,'BC0012'),
  (13,13,'BC0013'), (14,14,'BC0014'), (15,15,'BC0015'), (16,16,'BC0016'),
  (17,17,'BC0017')
) AS v(copy_id, book_id, barcode)
WHERE NOT EXISTS (SELECT 1 FROM loan.book_copy c WHERE c.copy_id = v.copy_id);

-- 6. 借阅快照（C 的借还列表靠它显示书名）
INSERT INTO loan.book_snapshot (book_id, title, isbn, updated_at)
SELECT b.book_id, b.title, b.isbn, clock_timestamp()::timestamp
FROM catalog.book b
WHERE b.book_id BETWEEN 5 AND 17
  AND NOT EXISTS (SELECT 1 FROM loan.book_snapshot s WHERE s.book_id = b.book_id);

UPDATE catalog.book b SET publisher = v.pub, publish_year = v.yr, summary = v.sm, updated_at = clock_timestamp()::timestamp
FROM (VALUES
  (2,  '作家出版社',     2012, '以福贵的一生，讲述人如何承受苦难并继续活着。'),
  (5,  '重庆出版社',     2008, '地球文明与三体文明的第一次接触，宏大的宇宙社会学寓言。'),
  (6,  '南海出版公司',   2011, '布恩迪亚家族七代人的传奇，魔幻现实主义的巅峰之作。'),
  (7,  '中信出版社',     2014, '从认知革命到科学革命，重新理解智人的崛起。'),
  (8,  '机械工业出版社', 2013, '算法领域的经典教材，覆盖排序、图论与动态规划。'),
  (9,  '机械工业出版社', 2016, '从程序员视角贯通硬件、操作系统与编译系统。'),
  (10, '中信出版社',     2018, '芒格的多元思维模型与投资智慧合集。'),
  (11, '中信出版社',     2018, '桥水基金创始人的生活与工作原则。'),
  (12, '机械工业出版社', 2015, '以对话形式阐释阿德勒心理学与课题分离。'),
  (13, '中信出版社',     2012, '系统 1 与系统 2，揭示人类判断中的偏差。'),
  (14, '中华书局',       2007, '从平淡的一年切入，透视明代政治与社会结构。'),
  (15, '浙江文艺出版社', 2017, '在满地六便士的时代，抬头看见月亮。'),
  (16, '高等教育出版社', 2014, '数据库原理、关系代数、SQL、事务与并发控制的经典教材。'),
  (17, '清华大学出版社', 2013, '搜索、知识表示、机器学习与机器人学的系统教材。')
) AS v(id, pub, yr, sm)
WHERE b.book_id = v.id AND b.book_id BETWEEN 5 AND 17;

COMMIT;

-- 校验：应分别为 7 个分类、17 本书、17 个副本
-- SELECT (SELECT count(*) FROM catalog.category) AS categories,
--        (SELECT count(*) FROM catalog.book)     AS books,
--        (SELECT count(*) FROM loan.book_copy)   AS copies;
