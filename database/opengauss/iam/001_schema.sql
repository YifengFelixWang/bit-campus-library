-- 由初始化账户在空库中执行。业务账户不执行本文件。
-- 全组日常导入使用 database/opengauss/dist，不重复执行本文件。

CREATE SCHEMA IF NOT EXISTS iam;

CREATE TABLE iam.app_user (
    user_id       BIGINT PRIMARY KEY,
    username      VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    display_name  VARCHAR(100) NOT NULL,
    enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at    TIMESTAMP NOT NULL,
    deleted       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE iam.app_role (
    role_id   BIGINT PRIMARY KEY,
    role_code VARCHAR(32) NOT NULL UNIQUE,
    role_name VARCHAR(32) NOT NULL,
    CONSTRAINT ck_app_role_code CHECK (role_code IN ('READER', 'LIBRARIAN', 'ANALYST', 'OPERATOR'))
);

CREATE TABLE iam.user_role (
    user_id BIGINT NOT NULL,
    role_id BIGINT NOT NULL,
    PRIMARY KEY (user_id, role_id),
    CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES iam.app_user (user_id),
    CONSTRAINT fk_user_role_role FOREIGN KEY (role_id) REFERENCES iam.app_role (role_id)
);

CREATE TABLE iam.db_identity_mapping (
    user_id      BIGINT NOT NULL,
    service_code VARCHAR(32) NOT NULL,
    db_username  VARCHAR(64) NOT NULL,
    PRIMARY KEY (user_id, service_code),
    CONSTRAINT fk_mapping_user FOREIGN KEY (user_id) REFERENCES iam.app_user (user_id),
    CONSTRAINT ck_mapping_service CHECK (service_code IN ('iam', 'catalog', 'loan', 'report'))
);
