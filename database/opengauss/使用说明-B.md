# 使用说明：B

读者连接 `db_catalog_reader01` 或 `db_catalog_reader02`，只查询。馆员连接 `db_catalog_librarian01`，可维护书目和导入。主机 `localhost`，端口 `15432`，库名 `library`。口令见本机 `.env`。

可以读写 `category`、`book`、`author`、`book_author`、`media`。

- `category_id`、`book_id`、`author_id` 由书目服务生成。分类 1 和 2、图书 1 到 4、作者 1 到 4 已用于演示。新编号从 5 开始。
- 导入只写 catalog。导入功能的使用者是馆员。
- 请提供分类查询、图书查询，以及给同步用的变更接口。变更接口包含分类、书号、书名、ISBN、分类编号、作者名字符串、`updatedAt`、`deleted`。
- 封面文件放到持久化目录，`media.file_url` 保存地址。种子里的地址是 `covers/book-1.jpg` 这一类占位路径。封面备份清单由你维护。
- 演示时你讲书目导入和封面。导出由 D 讲。
- 不要另写建表脚本，也不要查询 loan 或 report。

开发前按 `06-重建顺序.md` 导入 `dist` 下的两份文件。
