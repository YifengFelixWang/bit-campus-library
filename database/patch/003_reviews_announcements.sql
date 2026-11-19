-- =============================================================
-- 评价与公告（前端已有页面，D 的原始 schema 里没有）
-- 提案方：B　执行者：初始化账户（D）　幂等：IF NOT EXISTS
-- 放置位置：catalog schema（与书目同域，不新建 schema，避免破坏 D 的四 schema 约定）
-- 跨 schema 仍不建外键：user_id 指向 iam.app_user，只存编号
-- =============================================================

BEGIN;

-- 书评：一位读者对一本书只保留一条（软删后重新可评）
CREATE TABLE IF NOT EXISTS catalog.review (
    review_id  BIGINT PRIMARY KEY,
    book_id    BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    rating     INTEGER NOT NULL,
    content    VARCHAR(1000),
    created_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT ck_review_rating CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT fk_review_book FOREIGN KEY (book_id) REFERENCES catalog.book (book_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uk_review_user_book
    ON catalog.review (book_id, user_id) WHERE deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_review_book ON catalog.review (book_id);

-- 公告：运维/馆员发布，未发布的不对外
CREATE TABLE IF NOT EXISTS catalog.announcement (
    announcement_id BIGINT PRIMARY KEY,
    title           VARCHAR(200) NOT NULL,
    content         VARCHAR(2000) NOT NULL,
    published       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMP NOT NULL,
    updated_at      TIMESTAMP NOT NULL,
    deleted         BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_announcement_published ON catalog.announcement (published, created_at DESC);

GRANT SELECT ON catalog.review, catalog.announcement TO db_catalog_reader01, db_catalog_reader02;
GRANT INSERT, UPDATE ON catalog.review TO db_catalog_reader01, db_catalog_reader02;
GRANT SELECT, INSERT, UPDATE ON catalog.review, catalog.announcement TO db_catalog_librarian01;
COMMIT;
