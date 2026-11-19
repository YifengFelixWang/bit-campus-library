-- 由初始化账户在空库中执行。业务账户不执行本文件。
-- 全组日常导入使用 database/opengauss/dist，不重复执行本文件。

CREATE SCHEMA IF NOT EXISTS loan;

CREATE TABLE loan.borrower_account (
    user_id        BIGINT PRIMARY KEY,
    max_loan_count INTEGER NOT NULL DEFAULT 5,
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at     TIMESTAMP NOT NULL
);

CREATE TABLE loan.book_copy (
    copy_id    BIGINT PRIMARY KEY,
    book_id    BIGINT NOT NULL,
    barcode    VARCHAR(64) NOT NULL UNIQUE,
    status     VARCHAR(32) NOT NULL,
    updated_at TIMESTAMP NOT NULL,
    CONSTRAINT ck_copy_status CHECK (status IN ('AVAILABLE', 'BORROWED'))
);

CREATE TABLE loan.book_snapshot (
    book_id    BIGINT PRIMARY KEY,
    title      VARCHAR(200) NOT NULL,
    isbn       VARCHAR(32) NOT NULL,
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE loan.loan_record (
    loan_id     BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    copy_id     BIGINT NOT NULL,
    book_id     BIGINT NOT NULL,
    status      VARCHAR(32) NOT NULL,
    borrowed_at TIMESTAMP NOT NULL,
    due_at      TIMESTAMP,
    returned_at TIMESTAMP,
    updated_at  TIMESTAMP NOT NULL,
    deleted     BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_loan_borrower FOREIGN KEY (user_id) REFERENCES loan.borrower_account (user_id),
    CONSTRAINT fk_loan_copy FOREIGN KEY (copy_id) REFERENCES loan.book_copy (copy_id),
    CONSTRAINT fk_loan_snapshot FOREIGN KEY (book_id) REFERENCES loan.book_snapshot (book_id),
    CONSTRAINT ck_loan_status CHECK (status IN ('BORROWED', 'RETURNED'))
);

CREATE TABLE loan.request_dedup (
    request_no     VARCHAR(64) PRIMARY KEY,
    user_id        BIGINT NOT NULL,
    operation_type VARCHAR(32) NOT NULL,
    copy_id        BIGINT NOT NULL,
    loan_id        BIGINT,
    created_at     TIMESTAMP NOT NULL
);

CREATE TABLE loan.loan_audit (
    audit_id         BIGSERIAL PRIMARY KEY,
    loan_id          BIGINT NOT NULL,
    old_status       VARCHAR(32),
    new_status       VARCHAR(32),
    operator_user_id BIGINT NOT NULL,
    request_no       VARCHAR(64),
    created_at       TIMESTAMP NOT NULL,
    CONSTRAINT fk_audit_loan FOREIGN KEY (loan_id) REFERENCES loan.loan_record (loan_id)
);

CREATE INDEX idx_loan_user_status ON loan.loan_record (user_id, status);
CREATE INDEX idx_copy_book ON loan.book_copy (book_id);
