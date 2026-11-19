-- 由初始化账户在空库中执行。业务账户不执行本文件。
-- 全组日常导入使用 database/opengauss/dist，不重复执行本文件。

CREATE SCHEMA IF NOT EXISTS report;

CREATE TABLE report.category_dim (
    category_id       BIGINT PRIMARY KEY,
    category_name     VARCHAR(100) NOT NULL,
    source_updated_at TIMESTAMP NOT NULL,
    synced_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE report.book_dim (
    book_id           BIGINT PRIMARY KEY,
    title             VARCHAR(200) NOT NULL,
    isbn              VARCHAR(32),
    category_id       BIGINT NOT NULL,
    author_names      VARCHAR(500) NOT NULL DEFAULT '',
    source_updated_at TIMESTAMP NOT NULL,
    synced_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE report.reader_dim (
    user_id           BIGINT PRIMARY KEY,
    display_name      VARCHAR(100) NOT NULL,
    role_code         VARCHAR(32) NOT NULL,
    source_updated_at TIMESTAMP NOT NULL,
    synced_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE report.loan_fact (
    loan_id           BIGINT PRIMARY KEY,
    user_id           BIGINT NOT NULL,
    book_id           BIGINT NOT NULL,
    copy_id           BIGINT NOT NULL,
    status            VARCHAR(32) NOT NULL,
    borrowed_at       TIMESTAMP NOT NULL,
    due_at            TIMESTAMP,
    returned_at       TIMESTAMP,
    source_updated_at TIMESTAMP NOT NULL,
    synced_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted           BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE report.sync_checkpoint (
    source_name       VARCHAR(32) PRIMARY KEY,
    cursor_updated_at TIMESTAMP,
    cursor_id         BIGINT,
    last_success_at   TIMESTAMP,
    last_error        VARCHAR(500),
    status            VARCHAR(32) NOT NULL
);

CREATE INDEX idx_book_dim_category ON report.book_dim (category_id);
CREATE INDEX idx_loan_fact_time_status ON report.loan_fact (borrowed_at, status);
CREATE INDEX idx_loan_fact_book ON report.loan_fact (book_id);
CREATE INDEX idx_loan_fact_user ON report.loan_fact (user_id);
