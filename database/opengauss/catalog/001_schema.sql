-- 由初始化账户在空库中执行。业务账户不执行本文件。
-- 全组日常导入使用 database/opengauss/dist，不重复执行本文件。

CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE catalog.category (
    category_id   BIGINT PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL,
    updated_at    TIMESTAMP NOT NULL,
    deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE catalog.book (
    book_id     BIGINT PRIMARY KEY,
    isbn        VARCHAR(32) NOT NULL UNIQUE,
    title       VARCHAR(200) NOT NULL,
    category_id BIGINT NOT NULL,
    updated_at  TIMESTAMP NOT NULL,
    deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_book_category FOREIGN KEY (category_id) REFERENCES catalog.category (category_id)
);

CREATE TABLE catalog.author (
    author_id   BIGINT PRIMARY KEY,
    author_name VARCHAR(100) NOT NULL,
    updated_at  TIMESTAMP NOT NULL,
    deleted     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE catalog.book_author (
    book_id   BIGINT NOT NULL,
    author_id BIGINT NOT NULL,
    PRIMARY KEY (book_id, author_id),
    CONSTRAINT fk_book_author_book FOREIGN KEY (book_id) REFERENCES catalog.book (book_id),
    CONSTRAINT fk_book_author_author FOREIGN KEY (author_id) REFERENCES catalog.author (author_id)
);

CREATE TABLE catalog.media (
    media_id   BIGINT PRIMARY KEY,
    book_id    BIGINT NOT NULL,
    file_url   VARCHAR(500) NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_media_book FOREIGN KEY (book_id) REFERENCES catalog.book (book_id)
);

CREATE INDEX idx_book_category ON catalog.book (category_id);
