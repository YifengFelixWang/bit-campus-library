package edu.library.catalog.web;

import edu.library.catalog.config.RoleContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;

/**
 * 书目维护：新增、修改、软删、CSV 导入导出、封面上传。
 * 全部走 librarian / admin 连接池（AuthFilter 已拦截读者）。
 * 不写 loan schema —— 副本由 C 的服务登记，避免跨服务写私表。
 */
@RestController
@RequestMapping("/api/catalog/books")
public class BookAdminController {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;
    private final Path coverDir;

    public BookAdminController(JdbcTemplate jdbc,
                               TransactionTemplate tx,
                               @Value("${catalog.upload.cover-dir:web/covers}") String coverDir) {
        this.jdbc = jdbc;
        this.tx = tx;
        this.coverDir = Paths.get(coverDir).toAbsolutePath().normalize();
    }

    // ------------------------------------------------------------------ 新增
    public record BookForm(String isbn, String title, Long categoryId, String category,
                           String author, String publisher, Integer year, String summary,
                           Integer totalCopies) {
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody BookForm f) {
        String err = validate(f);
        if (err != null) return fail("INVALID_ARGUMENT", err);

        Long categoryId = resolveCategory(f);
        if (categoryId == null) return fail("CATEGORY_NOT_FOUND", "分类不存在：" + f.category());

        try {
            Long bookId = tx.execute(s -> {
                Long id = jdbc.queryForObject(
                        "select coalesce(max(book_id),0)+1 from catalog.book", Long.class);
                jdbc.update("""
                        insert into catalog.book
                          (book_id,isbn,title,category_id,publisher,publish_year,summary,total_copies,updated_at,deleted)
                        values (?,?,?,?,?,?,?,?,localtimestamp,false)
                        """, id, f.isbn().trim(), f.title().trim(), categoryId,
                        blankToNull(f.publisher()), f.year(), blankToNull(f.summary()), copies(f));
                bindAuthor(id, f.author());
                return id;
            });
            return ok(Map.of("bookId", bookId, "action", "created"));
        } catch (RuntimeException e) {
            return fail("DUPLICATE_ISBN", "ISBN 已存在或写入失败：" + rootMessage(e));
        }
    }

    // ------------------------------------------------------------------ 修改
    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable long id, @RequestBody BookForm f) {
        String err = validate(f);
        if (err != null) return fail("INVALID_ARGUMENT", err);

        Integer exists = jdbc.queryForObject(
                "select count(*) from catalog.book where book_id=? and deleted=false", Integer.class, id);
        if (exists == null || exists == 0) return fail("BOOK_NOT_FOUND", "图书不存在或已下架");

        Long categoryId = resolveCategory(f);
        if (categoryId == null) return fail("CATEGORY_NOT_FOUND", "分类不存在：" + f.category());

        try {
            tx.executeWithoutResult(s -> {
                jdbc.update("""
                        update catalog.book
                           set isbn=?, title=?, category_id=?, publisher=?, publish_year=?, summary=?,
                               total_copies=coalesce(?, total_copies),
                               updated_at=localtimestamp
                         where book_id=?
                        """, f.isbn().trim(), f.title().trim(), categoryId,
                        blankToNull(f.publisher()), f.year(), blankToNull(f.summary()), f.totalCopies(), id);
                rebindAuthor(id, f.author());
            });
            return ok(Map.of("bookId", id, "action", "updated"));
        } catch (RuntimeException e) {
            return fail("DUPLICATE_ISBN", "ISBN 冲突或写入失败：" + rootMessage(e));
        }
    }

    // ------------------------------------------------------------------ 软删
    @DeleteMapping("/{id}")
    public Map<String, Object> remove(@PathVariable long id) {
        int n = jdbc.update(
                "update catalog.book set deleted=true, updated_at=localtimestamp where book_id=? and deleted=false", id);
        if (n == 0) return fail("BOOK_NOT_FOUND", "图书不存在或已下架");
        return ok(Map.of("bookId", id, "action", "off_shelf"));
    }

    /** 批量删除的请求体：{"bookIds": [1,2,3]} */
    public record BatchDelete(List<Long> bookIds) {}

    /**
     * 批量删除（软删，与 DELETE /{id} 同一语义）。
     *
     * 为什么是软删而不是物理 delete：
     *   1. 借阅记录（loan.loan_record）与书评（catalog.review）都还指着 book_id，
     *      物理删会让历史数据变成孤儿；项目从 006 号补丁起就定下「删除一律软删」。
     *   2. 馆员的连接账号没有 catalog.book 的 DELETE 权限（D 的权限设计），
     *      物理删需要额外授权，而软删只需 UPDATE。
     * 软删后读者端立即不可见，馆员可在「已下架」里恢复，真正做到可逆。
     */
    @PostMapping("/batch-delete")
    public Map<String, Object> batchDelete(@RequestBody BatchDelete body) {
        if (body == null || body.bookIds() == null || body.bookIds().isEmpty()) {
            return fail("INVALID_ARGUMENT", "请至少选择一本图书");
        }
        if (body.bookIds().size() > 500) {
            return fail("INVALID_ARGUMENT", "单次最多删除 500 本");
        }
        List<Long> ids = body.bookIds().stream().filter(Objects::nonNull).distinct().toList();
        if (ids.isEmpty()) return fail("INVALID_ARGUMENT", "请至少选择一本图书");

        int[] deleted = {0};
        List<Long> missing = new ArrayList<>();
        tx.executeWithoutResult(s -> {
            for (Long id : ids) {
                int n = jdbc.update(
                        "update catalog.book set deleted=true, updated_at=localtimestamp where book_id=? and deleted=false",
                        id);
                if (n == 0) missing.add(id); else deleted[0]++;
            }
        });

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("deleted", deleted[0]);
        out.put("missing", missing);
        out.put("action", "batch_off_shelf");
        return ok(out);
    }

    /** 重新上架（撤销软删） */
    @PostMapping("/{id}/restore")
    public Map<String, Object> restore(@PathVariable long id) {
        int n = jdbc.update(
                "update catalog.book set deleted=false, updated_at=localtimestamp where book_id=? and deleted=true", id);
        if (n == 0) return fail("BOOK_NOT_FOUND", "图书不存在或已是上架状态");
        return ok(Map.of("bookId", id, "action", "on_shelf"));
    }

    // ------------------------------------------------------------------ 导出
    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String keyword,
                                         @RequestParam(required = false) Long categoryId) {
        StringBuilder sql = new StringBuilder("""
                select b.book_id, b.isbn, b.title, c.category_name,
                       coalesce((select string_agg(a.author_name,'/' order by ba.author_id)
                                   from catalog.book_author ba join catalog.author a on a.author_id=ba.author_id
                                  where ba.book_id=b.book_id),'') as "author",
                       coalesce(b.publisher,'')     as "publisher",
                       coalesce(b.publish_year,0)   as "pubYear",
                       coalesce(b.total_copies,0)   as "copies",
                       coalesce(b.summary,'')       as "summary"
                  from catalog.book b join catalog.category c on c.category_id=b.category_id
                 where b.deleted=false
                """);
        List<Object> args = new ArrayList<>();
        if (categoryId != null) { sql.append(" and b.category_id=?"); args.add(categoryId); }
        if (keyword != null && !keyword.isBlank()) {
            sql.append(" and (b.title ilike ? or b.isbn ilike ?)");
            args.add("%" + keyword.trim() + "%");
            args.add("%" + keyword.trim() + "%");
        }
        sql.append(" order by b.book_id");

        List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());
        StringBuilder csv = new StringBuilder("\uFEFF");   // BOM：Excel 打开不乱码
        csv.append("bookId,isbn,title,category,author,publisher,year,copies,summary\n");
        for (Map<String, Object> r : rows) {
            csv.append(csvCell(r.get("book_id"))).append(',')
               .append(csvCell(r.get("isbn"))).append(',')
               .append(csvCell(r.get("title"))).append(',')
               .append(csvCell(r.get("category_name"))).append(',')
               .append(csvCell(r.get("author"))).append(',')
               .append(csvCell(r.get("publisher"))).append(',')
               .append(csvCell(r.get("pubYear"))).append(',')
               .append(csvCell(r.get("copies"))).append(',')
               .append(csvCell(r.get("summary"))).append('\n');
        }
        byte[] body = csv.toString().getBytes(StandardCharsets.UTF_8);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=books.csv")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(body);
    }

    // ------------------------------------------------------------------ 导入
    /** 单行导入结果，回给前端用于「按馆藏数登记副本」 */
    private record Imported(Long bookId, boolean created) {}

    @PostMapping("/import")
    public Map<String, Object> importCsv(@RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) return fail("INVALID_ARGUMENT", "文件为空");
        String text = new String(file.getBytes(), StandardCharsets.UTF_8);
        if (text.startsWith("\uFEFF")) text = text.substring(1);

        String[] lines = text.split("\\r?\\n");
        if (lines.length < 2) return fail("INVALID_ARGUMENT", "文件只有表头，没有数据行");

        List<String> headers = splitCsv(lines[0]);
        Map<String, Integer> idx = new HashMap<>();
        for (int i = 0; i < headers.size(); i++) idx.put(normalizeHeader(headers.get(i)), i);

        List<String> required = List.of("isbn", "title", "category", "author");
        for (String h : required) {
            if (!idx.containsKey(h)) return fail("INVALID_TEMPLATE", "缺少必需列：" + h);
        }
        // 馆藏数可选：老的 7 列模板照旧能导，只是不写 total_copies
        boolean hasCopies = idx.containsKey("copies");

        int inserted = 0, updated = 0, failed = 0;
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Map<String, Object>> items = new ArrayList<>();

        for (int lineNo = 2; lineNo <= lines.length; lineNo++) {
            String raw = lines[lineNo - 1].trim();
            if (raw.isEmpty()) continue;
            List<String> cols = splitCsv(raw);
            try {
                String isbn = col(cols, idx, "isbn");
                String title = col(cols, idx, "title");
                String category = col(cols, idx, "category");
                String author = col(cols, idx, "author");
                String publisher = col(cols, idx, "publisher");
                String yearRaw = col(cols, idx, "year");
                String summary = col(cols, idx, "summary");

                if (isbn.isBlank()) throw new IllegalArgumentException("isbn 为空");
                if (title.isBlank()) throw new IllegalArgumentException("title 为空");
                Long categoryId = resolveCategoryName(category);
                if (categoryId == null) throw new IllegalArgumentException("分类不存在：" + category);
                Integer year = null;
                if (!yearRaw.isBlank()) {
                    year = Integer.parseInt(yearRaw);
                    if (year < 1900 || year > 2100) throw new IllegalArgumentException("年份超出范围：" + year);
                }

                int copies = 0;
                if (hasCopies) {
                    String copiesRaw = col(cols, idx, "copies");
                    copies = parseCopies(copiesRaw);
                    if (copies > 50) throw new IllegalArgumentException("馆藏数不能超过 50：" + copiesRaw);
                }
                final Integer yearValue = year;
                final Integer copiesValue = hasCopies ? Integer.valueOf(copies) : null;   // null = 不改动

                Imported done = tx.execute(s -> {
                    List<Long> hit = jdbc.queryForList(
                            "select book_id from catalog.book where isbn=? ", Long.class, isbn);
                    if (hit.isEmpty()) {
                        Long id = jdbc.queryForObject(
                                "select coalesce(max(book_id),0)+1 from catalog.book", Long.class);
                        jdbc.update("""
                                insert into catalog.book
                                  (book_id,isbn,title,category_id,publisher,publish_year,summary,total_copies,updated_at,deleted)
                                values (?,?,?,?,?,?,?,?,localtimestamp,false)
                                """, id, isbn, title, categoryId, blankToNull(publisher),
                                yearValue, blankToNull(summary), copiesValue == null ? 0 : copiesValue);
                        rebindAuthor(id, author);
                        return new Imported(id, true);
                    } else {
                        Long id = hit.get(0);
                        // total_copies 用 coalesce：CSV 没写这一列时保持库里的原值
                        jdbc.update("""
                                update catalog.book set title=?, category_id=?, publisher=?, publish_year=?,
                                       summary=?, total_copies=coalesce(?, total_copies),
                                       updated_at=localtimestamp, deleted=false
                                 where book_id=?
                                """, title, categoryId, blankToNull(publisher),
                                yearValue, blankToNull(summary), copiesValue, id);
                        rebindAuthor(id, author);
                        return new Imported(id, false);
                    }
                });

                if (done.created()) inserted++; else updated++;

                Map<String, Object> item = new LinkedHashMap<>();
                item.put("bookId", done.bookId());
                item.put("isbn", isbn);
                item.put("title", title);
                item.put("copies", copies);
                item.put("action", done.created() ? "inserted" : "updated");
                items.add(item);
            } catch (Exception e) {
                failed++;
                errors.add(Map.of("line", lineNo, "isbn", col(cols, idx, "isbn"),
                        "reason", rootMessage(e)));
            }
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", inserted + updated + failed);
        out.put("inserted", inserted);
        out.put("updated", updated);
        out.put("failed", failed);
        out.put("copiesColumn", hasCopies);
        out.put("items", items);
        out.put("errors", errors);
        return ok(out);
    }

    /** 导入模板下载 */
    @GetMapping("/import-template")
    public ResponseEntity<byte[]> template() {
        String csv = "\uFEFFisbn,title,category,author,publisher,year,copies,summary\n"
                + "978-7-000-00001-1,示例书名,文学,示例作者,示例出版社,2020,3,示例简介\n";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=books-template.csv")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(csv.getBytes(StandardCharsets.UTF_8));
    }

    // ------------------------------------------------------------------ 封面
    @PostMapping("/{id}/cover")
    public Map<String, Object> uploadCover(@PathVariable long id,
                                           @RequestParam("file") MultipartFile file) throws IOException {
        Integer exists = jdbc.queryForObject(
                "select count(*) from catalog.book where book_id=? and deleted=false", Integer.class, id);
        if (exists == null || exists == 0) return fail("BOOK_NOT_FOUND", "图书不存在");

        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        String ext = name.endsWith(".png") ? "png" : (name.endsWith(".jpg") || name.endsWith(".jpeg")) ? "jpg" : null;
        if (ext == null) return fail("INVALID_FILE_TYPE", "只支持 jpg / png");
        if (file.getSize() > 2 * 1024 * 1024) return fail("FILE_TOO_LARGE", "文件不能超过 2 MB");

        Files.createDirectories(coverDir);
        Path target = coverDir.resolve(id + "." + ext);
        Files.write(target, file.getBytes());

        String url = "covers/" + id + "." + ext;
        tx.executeWithoutResult(s -> {
            jdbc.update("update catalog.media set deleted=true where book_id=?", id);
            Long mediaId = jdbc.queryForObject(
                    "select coalesce(max(media_id),0)+1 from catalog.media", Long.class);
            jdbc.update("""
                    insert into catalog.media (media_id,book_id,file_url,updated_at,deleted)
                    values (?,?,?,localtimestamp,false)
                    """, mediaId, id, url);
        });
        return ok(Map.of("bookId", id, "coverUrl", url));
    }

    // ------------------------------------------------------------------ 工具
    private void bindAuthor(Long bookId, String author) {
        Long authorId = ensureAuthor(author);
        if (authorId == null) return;
        jdbc.update("insert into catalog.book_author (book_id,author_id) values (?,?)", bookId, authorId);
    }

    /**
     * 重新绑定作者。馆员没有 DELETE 权限（D 的设计：删除一律软删），
     * 所以这里不能"先删后插"，只能就地 UPDATE；没有关联时才 INSERT。
     */
    private void rebindAuthor(Long bookId, String author) {
        Long authorId = ensureAuthor(author);
        if (authorId == null) return;
        Integer existing = jdbc.queryForObject(
                "select count(*) from catalog.book_author where book_id=?", Integer.class, bookId);
        if (existing == null || existing == 0) {
            jdbc.update("insert into catalog.book_author (book_id,author_id) values (?,?)", bookId, authorId);
        } else {
            jdbc.update("update catalog.book_author set author_id=? where book_id=?", authorId, bookId);
        }
    }

    /** 按名字取作者，没有就新建 */
    private Long ensureAuthor(String author) {
        if (author == null || author.isBlank()) return null;
        String name = author.trim();
        List<Long> hit = jdbc.queryForList(
                "select author_id from catalog.author where author_name=? ", Long.class, name);
        if (!hit.isEmpty()) return hit.get(0);
        Long authorId = jdbc.queryForObject("select coalesce(max(author_id),0)+1 from catalog.author", Long.class);
        jdbc.update("insert into catalog.author (author_id,author_name,updated_at,deleted) values (?,?,localtimestamp,false)",
                authorId, name);
        return authorId;
    }

    private Long resolveCategory(BookForm f) {
        if (f.categoryId() != null) return f.categoryId();
        return resolveCategoryName(f.category());
    }

    private Long resolveCategoryName(String name) {
        if (name == null || name.isBlank()) return null;
        List<Long> hit = jdbc.queryForList(
                "select category_id from catalog.category where category_name=? and deleted=false",
                Long.class, name.trim());
        return hit.isEmpty() ? null : hit.get(0);
    }

    private String validate(BookForm f) {
        if (f == null) return "请求体为空";
        if (f.isbn() == null || f.isbn().isBlank()) return "ISBN 不能为空";
        if (f.title() == null || f.title().isBlank()) return "书名不能为空";
        if (f.categoryId() == null && (f.category() == null || f.category().isBlank())) return "分类不能为空";
        if (f.year() != null && (f.year() < 1900 || f.year() > 2100)) return "出版年需在 1900-2100";
        return null;
    }

    private static int copies(BookForm f) {
        if (f.totalCopies() == null || f.totalCopies() < 0) return 0;
        return Math.min(f.totalCopies(), 50);
    }

    /** 表头归一化：中文/驼峰写法都映射到同一列名，兼容各版本模板 */
    private static String normalizeHeader(String raw) {
        String h = raw == null ? "" : raw.trim().toLowerCase().replace("\uFEFF", "");
        return switch (h) {
            case "馆藏数", "馆藏册数", "馆藏", "册数", "数量",
                 "totalcopies", "total_copies", "quantity", "qty", "count" -> "copies";
            case "书名" -> "title";
            case "作者" -> "author";
            case "分类" -> "category";
            case "出版社" -> "publisher";
            case "出版年", "年份" -> "year";
            case "简介" -> "summary";
            default -> h;
        };
    }

    /** 馆藏数容错：允许 3、3.0、空值；非法值直接让该行失败 */
    private static int parseCopies(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return 0;
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            try {
                return (int) Math.round(Double.parseDouble(s));
            } catch (NumberFormatException e2) {
                throw new IllegalArgumentException("馆藏数不是数字：" + raw);
            }
        }
    }

    private static String col(List<String> cols, Map<String, Integer> idx, String key) {
        Integer i = idx.get(key);
        if (i == null || i >= cols.size()) return "";
        return cols.get(i).trim();
    }

    /** 简易 CSV 解析：支持双引号包裹与 "" 转义 */
    private static List<String> splitCsv(String line) {
        List<String> out = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean quoted = false;
        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (quoted) {
                if (c == '"') {
                    if (i + 1 < line.length() && line.charAt(i + 1) == '"') { cur.append('"'); i++; }
                    else quoted = false;
                } else cur.append(c);
            } else if (c == '"') {
                quoted = true;
            } else if (c == ',') {
                out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        out.add(cur.toString());
        return out;
    }

    private static String csvCell(Object v) {
        String s = v == null ? "" : String.valueOf(v);
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            return '"' + s.replace("\"", "\"\"") + '"';
        }
        return s;
    }

    private static String blankToNull(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) t = t.getCause();
        String m = t.getMessage();
        return m == null ? t.getClass().getSimpleName() : m;
    }

    private static Map<String, Object> ok(Object data) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", "OK");
        m.put("message", "");
        m.put("data", data);
        m.put("actor", RoleContext.username());
        return m;
    }

    private static Map<String, Object> fail(String code, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("message", message);
        return m;
    }
}
