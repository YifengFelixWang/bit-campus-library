-- 电子书（PDF）附件
--
-- 背景：详情页原来只有一个「PDF 试读」占位，前端读的是浏览器本地演示字段 pdf_blob，后端没有对应存储，
-- 任何一本书都显示「未上传」。现在给每本书挂一个真实 PDF：管理员可上传，所有人可下载。
--
-- 设计：文件落在宿主机目录（catalog 与 nginx 共享），库里只存元数据；
-- 一本书一份，重新上传即覆盖，不做多版本。脚本可重复执行。

BEGIN;

CREATE TABLE IF NOT EXISTS catalog.ebook (
    book_id     bigint NOT NULL PRIMARY KEY,
    file_name   varchar(160) NOT NULL,
    size_bytes  bigint NOT NULL,
    uploaded_by bigint,
    updated_at  timestamp without time zone NOT NULL,
    deleted     boolean DEFAULT false NOT NULL
)
WITH (orientation=row, compression=no);

ALTER TABLE catalog.ebook OWNER TO gaussdb;

GRANT SELECT ON TABLE catalog.ebook TO db_catalog_reader01;
GRANT SELECT ON TABLE catalog.ebook TO db_catalog_reader02;
GRANT SELECT, INSERT, UPDATE ON TABLE catalog.ebook TO db_catalog_librarian01;

COMMIT;
