# catalog-service 接口契约（B 提案，待 A 冻结）

本文保留 B 的接口设计。当前可运行的入口和联调步骤见[工程说明](../README.md)，例如文中的同步接口属于后续规划。


> **注意**：本文是 2026-11-15 的接口提案，只覆盖当时规划的 6 个读接口。
> 后续新增的写接口、封面上传、CSV 导入导出、评价、公告、运维状态等均未收录于此。
> **当前实际接口清单以 `docs/B-交接方案.md` 第 6 章为准。**

服务：`catalog-service` · 端口 `8082` · 包名 `edu.library.catalog`
数据：只访问 `catalog` schema（`book` / `author` / `book_author` / `category` / `media` / `review` / `announcement`）

---

## 0 通用约定

| 项 | 约定 |
|---|---|
| 前缀 | `/api/catalog` |
| 响应包装 | `{ "code": "OK", "message": "", "data": <payload>, "requestId": "<uuid>" }` |
| 失败 | `{ "code": "BOOK_NOT_FOUND", "message": "图书不存在", "requestId": "..." }` |
| HTTP 状态 | 400 参数 / 401 未认证 / 403 越权 / 404 不存在 / 409 业务冲突 / 503 数据库不可用 |
| 分页 | `page` 从 1 开始，`size` 默认 10、上限 100；返回 `total` / `totalPages` |
| 排序 | 白名单 `updatedAt` / `title` / `publishYear`，方向 `asc` / `desc`；非法字段返回 400 `INVALID_SORT_FIELD` |
| 时间 | ISO 8601 不带时区后缀，语义为 Asia/Shanghai，保留微秒（与 D 的 TIMESTAMP 一致） |
| 鉴权 | `Authorization: Bearer <token>`，调用 A 的 `GET /users/me` 校验，结果按 60 秒缓存 |
| 角色码 | `READER` / `LIBRARIAN` / `ANALYST` / `OPERATOR`（来自 D 的 `iam.app_role`） |
| 数据库身份 | `reader01→db_catalog_reader01`、`reader02→db_catalog_reader02`、`librarian01→db_catalog_librarian01`；映射写在配置里 |

错误码：`BOOK_NOT_FOUND`、`ISBN_DUPLICATED`、`CATEGORY_NOT_FOUND`、`INVALID_ARGUMENT`、`INVALID_SORT_FIELD`、`IMPORT_TEMPLATE_INVALID`、`MEDIA_UNSUPPORTED`、`MEDIA_TOO_LARGE`、`FORBIDDEN`

---

## 1 对外接口

| # | 方法 | 路径 | 角色 | 用途 |
|---|---|---|---|---|
| 1 | GET | `/categories` | 任意 | 分类列表 + 每类书目数（首页 chips） |
| 2 | GET | `/books` | 任意 | 书目分页检索（列表页） |
| 2.1 | GET | `/books/search` | 任意 | **多条件联动检索**（全部图书页的多条件表单，一次关联 5 张表） |
| 3 | GET | `/books/{id}` | 任意 | 书目详情 |
| 4 | GET | `/books/latest?limit=8` | 任意 | 最近上新（热门榜未就绪时的降级） |
| 5 | POST | `/books` | LIBRARIAN | 新增书目 |
| 6 | PUT | `/books/{id}` | LIBRARIAN | 修改书目 |
| 7 | DELETE | `/books/{id}` | LIBRARIAN | 下架 / 删除（软删，可恢复） |
| 8 | POST | `/books/import` | LIBRARIAN | CSV 导入，支持 `copies`（馆藏数）列，返回逐条 bookId |
| 8.1 | POST | `/books/batch-delete` | LIBRARIAN | 批量删除（软删），单次 ≤ 500 本 |
| 9 | GET | `/books/export` | LIBRARIAN / ANALYST | 导出 CSV（UTF-8 BOM） |
| 10 | POST | `/media/covers` | LIBRARIAN | 上传封面，写入持久化目录 + media 表 |
| 11 | GET | `/internal/changes` | sync-bot | 增量同步（给 D 的 report） |

封面读取不走本服务：`media.file_url` 存 `covers/xxx.jpg`，由 Nginx 直接托管 `COVER_DIR`。

### 1 GET /categories

```json
{ "code":"OK", "data":[
  { "categoryId":1, "categoryName":"文学", "bookCount":3 },
  { "categoryId":2, "categoryName":"计算机", "bookCount":1 }
]}
```
只返回 `deleted = false` 的分类；`bookCount` 统计未删除书目。不返回树形结构（课程只演示一级分类）。

### 2 GET /books

查询参数：`page` `size` `keyword`（匹配 title / isbn / author_name）`categoryId` `status`（`ON_SHELF` / `OFF_SHELF`）`sortBy` `sortOrder`

```json
{ "code":"OK", "data":{
  "page":1, "size":10, "total":42, "totalPages":5,
  "items":[{
    "bookId":1, "title":"红楼梦", "isbn":"978-7-00000001",
    "categoryId":1, "categoryName":"文学",
    "authorNames":["曹雪芹"],
    "publisher":"人民文学出版社", "publishYear":2008, "summary":"……",
    "coverUrl":"covers/book-1.jpg",
    "shelfStatus":"ON_SHELF",
    "updatedAt":"2026-10-01T09:00:00.000000"
  }]
}}
```

**不返回可借册数**。可借数由前端并行调用 C 的 `GET /api/availability?bookIds=`；该调用失败时页面显示「状态未知」，书目浏览不受影响。

### 2.1 GET /books/search（多条件联动）

与 `/books` 的区别：`/books` 是**单关键词**检索（书名 / ISBN / 出版社 / 作者 OR 在一起），
本接口是**每个条件各自生效、彼此 AND** 的多条件表单。

| 参数 | 类型 | 说明 |
|---|---|---|
| `title` | string(≤100) | 书名，模糊匹配 `book.title` |
| `author` | string(≤100) | 作者，模糊匹配 `author.author_name`（EXISTS 子查询，不产生重复行） |
| `publisher` | string(≤100) | 出版社，模糊匹配 `book.publisher` |
| `isbn` | string(≤100) | ISBN，模糊匹配 `book.isbn` |
| `categoryId` | int | 分类，等值 `book.category_id` |
| `yearFrom` / `yearTo` | int(1000–2100) | 出版年份区间（闭区间）；`from > to` 直接 400 |
| `status` | `ON_SHELF` / `OFF_SHELF` / `ALL` | **不传 = 不限（含已下架）**；前端默认传 `ON_SHELF` |
| `sortBy` | `updatedAt` / `title` / `publishYear` / `bookId` | 白名单枚举，未知值 400 `INVALID_SORT_FIELD` |
| `sortOrder` | `asc` / `desc` | 默认 `desc` |
| `page` / `size` | int | `size` 默认 12，上限 100 |

一次请求关联 5 张表：`catalog.book`（主表）、`catalog.category`（JOIN 取分类名）、
`catalog.book_author` + `catalog.author`（作者聚合与作者过滤）、`catalog.media`（最新封面）。

```json
{ "code":"OK", "data":{
  "page":1, "size":12, "total":2, "totalPages":1,
  "joinTables":["catalog.book","catalog.category","catalog.book_author","catalog.author","catalog.media"],
  "appliedConditions":2,
  "items":[{ "bookId":4, "title":"数据库系统概念", "authorNames":"Abraham Silberschatz",
             "categoryName":"计算机", "publisher":null, "publishYear":2026,
             "coverUrl":"covers/4.png", "shelfStatus":"ON_SHELF", "totalCopies":1 }]
}}
```

`items` 字段与 `/books` 完全一致（含 `shelfStatus`、`totalCopies`），前端可复用同一套渲染。
`joinTables` 由服务端返回，前端不硬编码表清单；`appliedConditions` 是**服务端视角**的生效条件数
（含默认的 `ON_SHELF`），页面上的「已应用 N 个条件」按用户实际填写计算。

排序字段仍只来自 `BookSortField` 枚举，`ORDER BY` 用 `${}` 拼的是枚举常量而非请求值，值一律 `#{}` 预编译。

### 3 GET /books/{id}

同 2 的 item 结构，多返回 `authors: [{authorId, authorName}]` 与 `mediaId`。不存在返回 404 `BOOK_NOT_FOUND`。

### 4 GET /books/latest?limit=8

按 `updated_at` 倒序，结构同 2 的 items。**热门榜由 D 的 `/api/reports/hot` 提供**；本接口是它未就绪时的降级方案，前端不得同时展示两套排行。

### 5 POST /books

```json
{ "title":"围城", "isbn":"978-7-00000003", "categoryId":1,
  "authorNames":["钱锺书"], "publisher":"人民文学出版社",
  "publishYear":2013, "summary":"……" }
```
- `bookId` 由服务端生成：`select coalesce(max(book_id),4)+1 from catalog.book`，在同一事务内加表锁；
  **不使用序列**（dist 中已显式插入 1–4，序列不会跳过）。
- `authorNames` 逐个按名字查 `author`，不存在则新建，再写 `book_author`。
- ISBN 已存在返回 409 `ISBN_DUPLICATED`。
- 返回 201 + 完整 item。

### 6 PUT /books/{id}

全量覆盖可编辑字段（同上，不含 `bookId` / `isbn`）。`updated_at` 用 `clock_timestamp()`。

### 7 DELETE /books/{id}

馆员账户没有 `catalog.book` 的 DELETE 权限，因此「删除 / 下架」统一是 `deleted = true`（软删）并刷新 `updated_at`；
`POST /books/{id}/restore` 撤销。读者端检索与导出都带 `deleted = false` 过滤，所以删除后立即不可见，但借阅记录与书评不受影响。

**已知取舍**：软删不改变 `loan.book_copy` 的副本状态，在架副本仍可能被借出；需要时先下架再处理副本。

### 8 POST /books/import

`multipart/form-data`，字段名 `file`，接受 `.csv`（逗号），UTF-8（容 BOM）。

当前模板列：`isbn,title,category,author,publisher,year,copies,summary`
（也认中文表头：`书名 / 作者 / 分类 / 出版社 / 出版年 / 馆藏数 / 简介`；`copies` 别名 `馆藏数 / 馆藏册数 / 数量 / quantity` 等）。

- **`copies` 可选**：老的 7 列模板照旧能导，只是不写 `total_copies`；带了就写入 `catalog.book.total_copies`（0–50）。
- 该列只写"计划馆藏数"，**实际可借副本在 `loan.book_copy`**，由前端导入成功后调用借阅服务的
  `POST /api/copies/batch`（一次补齐到 `copies` 册，含快照 upsert，幂等）登记，重复导入同一文件不会重复建副本。
  早期版本的逐册 `POST /api/copies` 仅保留给单册补登，导入不再使用（200 行 × 5 册要发 1000 个请求，会中途断）。
- 响应带 `items`（逐行 bookId / title / copies / action），前端据此登记副本。

```json
{ "code":"OK", "data":{
  "total":3, "inserted":3, "updated":0, "failed":0,
  "copiesColumn":true,
  "items":[{"bookId":202,"isbn":"978-7-900-00001-9","title":"导入测试甲","copies":2,"action":"inserted"}],
  "errors":[]
}}
```

### 8.1 POST /books/batch-delete

```json
{ "bookIds": [12, 13, 14] }
```

逐条执行与 `DELETE /books/{id}` 相同的软删（`deleted = true`），整体在一个事务里。
单次最多 500 个 id，重复 id 自动去重，不存在的 id 进入 `missing` 而不是整批失败。

```json
{ "code":"OK", "data":{ "deleted":2, "missing":[999999], "action":"batch_off_shelf" } }
```

### 9 GET /books/export

查询参数同 2。返回 `text/csv;charset=utf-8`，**首字节写 `\uFEFF`**（否则 Excel 打开乱码）。
列顺序：`bookId,isbn,title,category,author,publisher,year,copies,summary`，与导入模板一致（多一列 bookId，导入时忽略），
导出的文件可以再导入（可重入）。

### 10 POST /media/covers

`multipart/form-data`，字段名 `file`，仅 `image/jpeg`、`image/png`、`image/webp`，≤ 2 MB。

服务端：存 `COVER_DIR/{bookId}-{uuid}.{ext}` → 写 `catalog.media`（`media_id` 由服务端生成、`file_url` 存相对路径）→ 返回 `{ "mediaId":5, "fileUrl":"covers/1-a1b2.jpg" }`。
旧封面不物理删除，`deleted=true`。

### 11 GET /internal/changes

`sync-bot` 专用（A 的 `/users/me` 返回 `username = sync-bot`），读者与馆员调用返回 403。

参数：`type`（`book` / `category`，必填）`afterTime`（默认 `1970-01-01T00:00:00`）`afterId`（默认 0）`limit`（1–500，默认 100）

```json
{ "code":"OK", "data":{
  "items":[{
    "bookId":1, "title":"红楼梦", "isbn":"978-7-00000001",
    "categoryId":1, "authorNames":"曹雪芹",
    "updatedAt":"2026-10-01T09:00:00.000000", "deleted":false
  }],
  "nextCursor":{ "afterTime":"2026-10-01T09:00:00.000000", "afterId":1 },
  "hasMore":false
}}
```

- 游标 `(updated_at, id)` 升序、严格大于上一游标，与 C 的 `/api/internal/loans/changes` 同构。
- `authorNames` 用分号拼成字符串，对应 `report.book_dim.author_names`。
- `type=category` 时返回 `categoryId / categoryName / updatedAt / deleted`。
- **需要 D 配合**：`report.sync_checkpoint` 的主键是 `source_name`，需拆成 `catalog.book` 与 `catalog.category` 两行。

### 12 GET /api/borrow-counts（借阅服务 C 提供 · 公开只读）

首页卡片上的「借阅 N」与热门排行都读这一个口径：**该书全部未删除借阅记录数**，
即正在借阅（BORROWED）与已归还（RETURNED）都各算一次，不区分状态。

```json
[ { "book_id":1, "borrows":1 }, { "book_id":7, "borrows":2 } ]
```

- 无鉴权：只返回 `book_id + 次数`，不含读者、副本、时间等任何明细，匿名访客也要能看到真实读数，
  否则未登录首页会整片显示「借阅 0」。
- 服务端 SQL：`select book_id, count(*) as borrows from loan.loan_record where not deleted group by book_id`，
  走 `db_loan_reader01` 连接池（只读）。
- 前端 `api.preload()` 把它合并成 `state.borrowCounts`，`mapBook()` 落到 `book.borrows`；
  书目列表 / 多条件查询 / 图书管理三处共用。
- 热门排序：`borrows` 降序 → 可借数降序 → `bookId` 升序；**每个视图最多 8 本**：
  指定分类 → 该分类前 8；「全部」→ 全馆前 8（按借阅量排序）。

---

## 2 与前端页面的对应

| 页面区块 | 调用 | 说明 |
|---|---|---|
| 首页 · 馆藏册数 | 本服务 `GET /books?size=1` 的 `total` | 只算书目种类；如需「册数」需 C 提供副本总数 |
| 首页 · 首屏「册可借图书」 | C 的 `GET /api/copies` 全量聚合 + 本服务 `total_copies` | 各书「馆藏 − 已借出」之和，点击滚到热门区 |
| 首页 · 首屏「本周口碑最高」 | 本服务 `GET /reviews` 聚合 | 近 7 天评价平均分最高（窗口内无评价则回退全量），点击打开该书详情 |
| 首页 · 热门图书 | C 的 `GET /api/borrow-counts` + 本服务 `GET /books` | 按借阅量排序，每个分类取前 8；D 的 `/api/reports/hot` 仍是备选 |
| 首页 · 可借标记 | C 的 `GET /api/availability?bookIds=` | 失败显示「未知」 |
| 首页 · 分类 chips | `GET /categories` | `bookCount` 直接用于角标 |
| 检索页 | `GET /books` + C 的 availability | 排序走白名单 |
| 详情页 | `GET /books/{id}` + C 的 availability | |
| 书目维护 | 5 / 6 / 7 / 8 / 9 / 10 | 保存成功后调 C 的 `PUT /api/book-snapshots` |
| 图片流演示 | `media.file_url` + Nginx | 不经 Java |
| 顶部节点徽标 / 控制台侧栏节点行 | 本服务 `GET /ops/status` | `primary` 为 null 时显示「单实例」，**不再读浏览器本地演示层**（`TataDB.clusterSnapshot()` 已停用） |

## 3 前端字段映射（回答「为什么加这三列」）

| 前端字段 | 来源 | 状态 |
|---|---|---|
| title / isbn / categoryId | `catalog.book` | 已有 |
| authorNames | `author` + `book_author` | 已有 |
| coverUrl | `catalog.media.file_url` | 已有 |
| **publisher / publishYear / summary** | `catalog.book` | **需扩充（本次提案）** |
| 可借 X / 馆藏 Y | `loan.book_copy` | 归 C，走接口 |
| 评分 rating | 无 | **砍掉**，课程无评价业务 |
| 历史借阅次数 | `report.loan_fact` | 归 D，走热门榜接口 |
| 单价 | 无 | **砍掉**，无业务动作 |
