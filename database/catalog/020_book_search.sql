-- =============================================================
-- 多表联动检索：存储过程版（B 侧，D 执行）
-- 依赖列（patch/001_catalog_extension.sql 已加）：publisher / publish_year / summary
-- 目标库：openGauss 5.x/6.x（PG 兼容模式）；纯 PostgreSQL 13+ 亦可直接执行
-- 返回：结果集 + total（count(*) OVER() 一次查全，避免 count 与数据两次快照不一致）
-- 调用：SELECT * FROM catalog.fn_search_books('红楼', 1, 'ON_SHELF', 'updatedAt', 'desc', 1, 10);
-- =============================================================

CREATE OR REPLACE FUNCTION catalog.fn_search_books(
    p_keyword     TEXT    DEFAULT NULL,   -- 命中 title / isbn / publisher / author_name
    p_category_id BIGINT DEFAULT NULL,   -- NULL = 全部分类
    p_status      TEXT    DEFAULT NULL,   -- ON_SHELF / OFF_SHELF / NULL
    p_sort_by     TEXT    DEFAULT 'updatedAt',
    p_sort_order  TEXT    DEFAULT 'desc',
    p_page        INTEGER DEFAULT 1,
    p_size        INTEGER DEFAULT 10
)
RETURNS TABLE (
    book_id       BIGINT,
    title         VARCHAR,
    isbn          VARCHAR,
    category_id   BIGINT,
    category_name VARCHAR,
    author_names  TEXT,
    publisher     VARCHAR,
    publish_year  INTEGER,
    summary       VARCHAR,
    total_copies  INTEGER,
    cover_url     VARCHAR,
    shelf_status  TEXT,
    updated_at    TIMESTAMP,
    total_count   BIGINT
)
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_sort_col TEXT;
    v_dir      TEXT;
    v_size     INTEGER;
    v_offset   INTEGER;
    v_status   TEXT;
    v_keyword  TEXT;
BEGIN
    -- ---------- 1. 参数归一：分页与状态在这里兜住，不信任调用方 ----------
    v_size := COALESCE(p_size, 10);
    IF v_size < 1 THEN
        v_size := 10;
    ELSIF v_size > 100 THEN
        v_size := 100;                      -- 与契约「size 上限 100」一致
    END IF;
    v_offset := (GREATEST(COALESCE(p_page, 1), 1) - 1) * v_size;

    v_status := NULLIF(upper(btrim(COALESCE(p_status, ''))), '');
    IF v_status IS NOT NULL AND v_status NOT IN ('ON_SHELF', 'OFF_SHELF') THEN
        RAISE EXCEPTION 'INVALID_ARGUMENT: 非法的 status=%', p_status;
    END IF;

    v_keyword := NULLIF(btrim(COALESCE(p_keyword, '')), '');

    -- ---------- 2. 排序白名单：全系统唯一出口 ----------
    -- ORDER BY 的列名无法用参数绑定，只能拼字符串，所以必须在这里枚举，
    -- 未知字段一律抛错（让上层转成 400 INVALID_SORT_FIELD），不允许透传
    v_sort_col := CASE lower(COALESCE(p_sort_by, 'updatedAt'))
                      WHEN 'updatedat'   THEN 'b.updated_at'
                      WHEN 'title'       THEN 'b.title'
                      WHEN 'publishyear' THEN 'b.publish_year'
                      WHEN 'bookid'      THEN 'b.book_id'
                      ELSE NULL
                  END;
    IF v_sort_col IS NULL THEN
        RAISE EXCEPTION 'INVALID_SORT_FIELD: %', p_sort_by;
    END IF;

    v_dir := CASE lower(COALESCE(p_sort_order, 'desc'))
                 WHEN 'asc' THEN 'ASC'
                 ELSE 'DESC'                -- 未知方向一律降级为 desc，不报错
             END;

    -- ---------- 3. 执行 ----------
    -- WHERE 用「NULL 短路」写法，条件恒在、只有参数变，执行计划可复用。
    -- 唯一动态的部分是 ORDER BY，已由白名单转成字面量。
    RETURN QUERY EXECUTE format($sql$
        SELECT b.book_id,
               b.title,
               b.isbn,
               b.category_id,
               c.category_name,
               (SELECT string_agg(a.author_name, ';' ORDER BY ba2.author_id)
                  FROM catalog.book_author ba2
                  JOIN catalog.author a ON a.author_id = ba2.author_id
                 WHERE ba2.book_id = b.book_id)           AS author_names,
               b.publisher,
               b.publish_year,
               b.summary,
               b.total_copies,
               (SELECT m.file_url
                  FROM catalog.media m
                 WHERE m.book_id = b.book_id
                   AND m.deleted = false
                 ORDER BY m.media_id DESC
                 LIMIT 1)                                 AS cover_url,
               CASE WHEN b.deleted THEN 'OFF_SHELF' ELSE 'ON_SHELF' END AS shelf_status,
               b.updated_at,
               count(*) OVER ()                           AS total_count
          FROM catalog.book b
          JOIN catalog.category c ON c.category_id = b.category_id
         WHERE ($1 IS NULL OR b.category_id = $1)
           AND ($2 IS NULL OR (
                    b.title     ILIKE '%%' || $2 || '%%'
                 OR b.isbn      ILIKE '%%' || $2 || '%%'
                 OR b.publisher ILIKE '%%' || $2 || '%%'
                 OR EXISTS (SELECT 1
                              FROM catalog.book_author ba3
                              JOIN catalog.author a3 ON a3.author_id = ba3.author_id
                             WHERE ba3.book_id = b.book_id
                               AND a3.author_name ILIKE '%%' || $2 || '%%')
                ))
           AND ($3 IS NULL OR b.deleted = ($3 = 'OFF_SHELF'))
         ORDER BY %s %s, b.book_id DESC
         LIMIT $4 OFFSET $5
    $sql$, v_sort_col, v_dir)
    USING p_category_id, v_keyword, v_status, v_size, v_offset;
END;
$fn$;

COMMENT ON FUNCTION catalog.fn_search_books(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER)
    IS '书目多表联动检索：book+category+author+book_author+media 关联，支持关键词/分类/状态筛选与白名单排序';

-- =============================================================
-- 变体：显式两段式（count + 分页）
-- 什么时候用：结果集很大、count(*) OVER() 的全量扫描扛不住时。
-- 代价：两次快照，极端并发下 total 与 items 可能差一条。
-- 只作为备选保留，不在默认路径上。
-- =============================================================
CREATE OR REPLACE FUNCTION catalog.fn_count_books(
    p_keyword     TEXT    DEFAULT NULL,
    p_category_id BIGINT DEFAULT NULL,
    p_status      TEXT    DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE sql
AS $fn$
    SELECT count(*)
      FROM catalog.book b
      JOIN catalog.category c ON c.category_id = b.category_id
     WHERE (p_category_id IS NULL OR b.category_id = p_category_id)
       AND (NULLIF(btrim(COALESCE(p_keyword, '')), '') IS NULL OR (
                b.title     ILIKE '%' || btrim(p_keyword) || '%'
             OR b.isbn      ILIKE '%' || btrim(p_keyword) || '%'
             OR b.publisher ILIKE '%' || btrim(p_keyword) || '%'
             OR EXISTS (SELECT 1
                          FROM catalog.book_author ba
                          JOIN catalog.author a ON a.author_id = ba.author_id
                         WHERE ba.book_id = b.book_id
                           AND a.author_name ILIKE '%' || btrim(p_keyword) || '%')
           ))
       AND (NULLIF(upper(btrim(COALESCE(p_status, ''))), '') IS NULL
            OR b.deleted = (upper(btrim(p_status)) = 'OFF_SHELF'));
$fn$;

-- =============================================================
-- 回滚
-- =============================================================
-- DROP FUNCTION IF EXISTS catalog.fn_search_books(TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER, INTEGER);
-- DROP FUNCTION IF EXISTS catalog.fn_count_books(TEXT, INTEGER, TEXT);
