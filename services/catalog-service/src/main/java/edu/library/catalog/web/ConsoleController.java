package edu.library.catalog.web;

import edu.library.catalog.config.RoleContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * 控制台真实数据接口：概览、用户（只读）、评价、公告、运维状态（预留）。
 *
 * 边界说明：
 *   - 用户写操作属于 A 的身份服务，这里只读；
 *   - 借阅统计由前端用 loan-service 的 /api/loans 汇总，这里不跨服务读 loan schema；
 *   - 主备/运维状态属于 E 的 dbops-service，这里返回"待接入"占位，同时给出真实的数据库连接信息。
 */
@RestController
@RequestMapping("/api/catalog")
public class ConsoleController {

    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public ConsoleController(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    // ---------------------------------------------------------------- 概览
    @GetMapping("/stats")
    public Map<String, Object> stats() {
        long books = count("select count(*) from catalog.book where deleted=false");
        long offShelf = count("select count(*) from catalog.book where deleted=true");
        long categories = count("select count(*) from catalog.category where deleted=false");
        long authors = count("select count(*) from catalog.author where deleted=false");
        long reviews = count("select count(*) from catalog.review where deleted=false");
        long announcements = count("select count(*) from catalog.announcement where deleted=false");
        double avg = 0;
        try {
            Double v = jdbc.queryForObject(
                    "select coalesce(avg(rating),0) from catalog.review where deleted=false", Double.class);
            avg = v == null ? 0 : v;
        } catch (RuntimeException ignored) {
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("books", books);
        data.put("offShelf", offShelf);
        data.put("categories", categories);
        data.put("authors", authors);
        data.put("reviews", reviews);
        data.put("announcements", announcements);
        data.put("avgRating", Math.round(avg * 10) / 10.0);
        data.put("source", "catalog schema");
        return ok(data);
    }

    // ---------------------------------------------------------------- 用户（不越界查询）
    @GetMapping("/users")
    public Map<String, Object> users() {
        // D 的约定：每个服务只连接自己的数据库用户，不查询其他 schema。
        // 用户与角色属于 iam schema，应由 A 的 identity-service 提供。
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", List.of());
        data.put("total", 0);
        data.put("owner", "A");
        data.put("status", "PENDING");
        data.put("note", "用户与角色数据属于 iam schema，由身份服务（A）提供；本服务按 D 的约定不跨 schema 查询");
        return ok(data);
    }

    // ---------------------------------------------------------------- 评价
    @GetMapping("/reviews")
    public Map<String, Object> reviews(@RequestParam(required = false) Long bookId,
                                       @RequestParam(defaultValue = "100") int limit) {
        StringBuilder sql = new StringBuilder("""
                select r.review_id  as "reviewId",
                       r.book_id    as "bookId",
                       b.title      as "bookTitle",
                       r.user_id    as "userId",
                       r.rating     as "rating",
                       r.content    as "content",
                       r.created_at as "createdAt"
                  from catalog.review r
                  join catalog.book b on b.book_id = r.book_id
                 where r.deleted = false
                """);
        List<Object> args = new ArrayList<>();
        if (bookId != null) {
            sql.append(" and r.book_id = ?");
            args.add(bookId);
        }
        sql.append(" order by r.created_at desc limit ?");
        args.add(Math.min(limit, 200));

        List<Map<String, Object>> rows = jdbc.queryForList(sql.toString(), args.toArray());
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", rows);
        data.put("total", rows.size());
        return ok(data);
    }

    public record ReviewForm(Long bookId, Integer rating, String content) {
    }

    @PostMapping("/reviews")
    public Map<String, Object> addReview(@RequestBody ReviewForm f) {
        Long userId = RoleContext.userId();
        if (userId == null || userId == 0) return fail("UNAUTHORIZED", "需要登录后发表评价");
        if (f.bookId() == null) return fail("INVALID_ARGUMENT", "缺少书目编号");
        if (f.rating() == null || f.rating() < 1 || f.rating() > 5) return fail("INVALID_ARGUMENT", "评分需在 1-5 之间");

        Integer bookExists = jdbc.queryForObject(
                "select count(*) from catalog.book where book_id=? and deleted=false", Integer.class, f.bookId());
        if (bookExists == null || bookExists == 0) return fail("BOOK_NOT_FOUND", "图书不存在");

        Long reviewId = tx.execute(s -> {
            Long id = jdbc.queryForObject("select coalesce(max(review_id),0)+1 from catalog.review", Long.class);
            // 同一用户对同一本书只保留一条有效评价（唯一索引保证），重复提交则更新
            Integer exists = jdbc.queryForObject("""
                    select count(*) from catalog.review
                     where book_id=? and user_id=? and deleted=false
                    """, Integer.class, f.bookId(), userId);
            if (exists != null && exists > 0) {
                jdbc.update("""
                        update catalog.review set rating=?, content=?, updated_at=localtimestamp
                         where book_id=? and user_id=? and deleted=false
                        """, f.rating(), f.content(), f.bookId(), userId);
                return jdbc.queryForObject("""
                        select review_id from catalog.review
                         where book_id=? and user_id=? and deleted=false
                        """, Long.class, f.bookId(), userId);
            }
            jdbc.update("""
                    insert into catalog.review (review_id,book_id,user_id,rating,content,created_at,updated_at,deleted)
                    values (?,?,?,?,?,localtimestamp,localtimestamp,false)
                    """, id, f.bookId(), userId, f.rating(), f.content());
            return id;
        });
        return ok(Map.of("reviewId", reviewId, "bookId", f.bookId(), "rating", f.rating()));
    }

    @DeleteMapping("/reviews/{id}")
    public Map<String, Object> removeReview(@PathVariable long id) {
        int n = jdbc.update("update catalog.review set deleted=true, updated_at=localtimestamp where review_id=? and deleted=false", id);
        if (n == 0) return fail("REVIEW_NOT_FOUND", "评价不存在");
        return ok(Map.of("reviewId", id, "action", "deleted"));
    }

    // ---------------------------------------------------------------- 公告
    @GetMapping("/announcements")
    public Map<String, Object> announcements(@RequestParam(defaultValue = "false") boolean publishedOnly) {
        String sql = """
                select announcement_id as "announcementId",
                       title           as "title",
                       content         as "content",
                       published       as "published",
                       created_at      as "createdAt",
                       updated_at      as "updatedAt"
                  from catalog.announcement
                 where deleted = false
                """ + (publishedOnly ? " and published = true" : "") + " order by created_at desc";
        List<Map<String, Object>> rows = jdbc.queryForList(sql);
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("items", rows);
        data.put("total", rows.size());
        return ok(data);
    }

    public record AnnouncementForm(String title, String content, Boolean published) {
    }

    @PostMapping("/announcements")
    public Map<String, Object> saveAnnouncement(@RequestBody AnnouncementForm f) {
        if (f.title() == null || f.title().isBlank()) return fail("INVALID_ARGUMENT", "标题不能为空");
        if (f.content() == null || f.content().isBlank()) return fail("INVALID_ARGUMENT", "内容不能为空");
        boolean published = Boolean.TRUE.equals(f.published());

        Long id = tx.execute(s -> {
            Long next = jdbc.queryForObject("select coalesce(max(announcement_id),0)+1 from catalog.announcement", Long.class);
            jdbc.update("""
                    insert into catalog.announcement
                      (announcement_id,title,content,published,created_at,updated_at,deleted)
                    values (?,?,?,?,localtimestamp,localtimestamp,false)
                    """, next, f.title().trim(), f.content().trim(), published);
            return next;
        });
        return ok(Map.of("announcementId", id, "published", published));
    }

    @DeleteMapping("/announcements/{id}")
    public Map<String, Object> removeAnnouncement(@PathVariable long id) {
        int n = jdbc.update("update catalog.announcement set deleted=true, updated_at=localtimestamp where announcement_id=? and deleted=false", id);
        if (n == 0) return fail("ANNOUNCEMENT_NOT_FOUND", "公告不存在");
        return ok(Map.of("announcementId", id, "action", "deleted"));
    }

    // ---------------------------------------------------------------- 运维状态（预留）
    @GetMapping("/ops/status")
    public Map<String, Object> opsStatus() {
        Map<String, Object> db = new LinkedHashMap<>();
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                    select current_database() as "database",
                           current_user    as "databaseUser",
                           version()       as "version",
                           (select count(*) from pg_stat_activity where datname = current_database()) as "connections"
                    """);
            db.putAll(row);
            db.put("reachable", true);
        } catch (RuntimeException e) {
            db.put("reachable", false);
            db.put("error", e.getMessage());
        }

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("status", "PENDING");
        data.put("message", "主备拓扑与故障转移需接入 E 的 dbops-service；当前仅展示数据库连接实况");
        data.put("owner", "E");
        data.put("database", db);
        data.put("primary", null);
        data.put("standby", null);
        data.put("replicationLagSeconds", null);
        return ok(data);
    }

    // ---------------------------------------------------------------- 工具
    private long count(String sql) {
        try {
            Long v = jdbc.queryForObject(sql, Long.class);
            return v == null ? 0 : v;
        } catch (RuntimeException e) {
            return 0;
        }
    }

    private static Map<String, Object> ok(Object data) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", "OK");
        m.put("message", "");
        m.put("data", data);
        return m;
    }

    private static Map<String, Object> fail(String code, String message) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("message", message);
        return m;
    }
}
