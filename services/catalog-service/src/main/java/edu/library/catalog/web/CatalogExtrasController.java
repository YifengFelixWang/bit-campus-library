package edu.library.catalog.web;

import edu.library.catalog.common.ApiResponse;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 分类、详情与健康检查。
 * 只读接口，走 server.datasource 指向的 gaussdb 账户；
 * 后续要做"按角色切连接池"时，把 JdbcTemplate 换成按 token 选池即可，控制器不用改。
 */
@RestController
@RequestMapping("/api/catalog")
public class CatalogExtrasController {

    private final JdbcTemplate jdbc;

    public CatalogExtrasController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 分类列表 + 每类书目数（首页 chips 的角标数字） */
    @GetMapping("/categories")
    public ApiResponse<List<Map<String, Object>>> categories(HttpServletRequest request) {
        String sql = """
                SELECT c.category_id   AS "categoryId",
                       c.category_name AS "categoryName",
                       count(b.book_id) AS "bookCount"
                  FROM catalog.category c
                  LEFT JOIN catalog.book b
                         ON b.category_id = c.category_id AND b.deleted = false
                 WHERE c.deleted = false
                 GROUP BY c.category_id, c.category_name
                 ORDER BY c.category_id
                """;
        return ApiResponse.ok(jdbc.queryForList(sql), requestId(request));
    }

    /** 单本书详情：book + 分类 + 作者聚合 + 封面 */
    @GetMapping("/books/{id}")
    public ApiResponse<Map<String, Object>> detail(@PathVariable long id, HttpServletRequest request) {
        String sql = """
                SELECT b.book_id       AS "bookId",
                       b.title         AS "title",
                       b.isbn          AS "isbn",
                       b.category_id   AS "categoryId",
                       c.category_name AS "categoryName",
                       (SELECT string_agg(a.author_name, ';' ORDER BY ba.author_id)
                          FROM catalog.book_author ba
                          JOIN catalog.author a ON a.author_id = ba.author_id
                         WHERE ba.book_id = b.book_id)                AS "authorNames",
                       (SELECT m.file_url
                          FROM catalog.media m
                         WHERE m.book_id = b.book_id AND m.deleted = false
                         ORDER BY m.media_id DESC LIMIT 1)            AS "coverUrl",
                       b.total_copies  AS "totalCopies",
                       CASE WHEN b.deleted THEN 'OFF_SHELF' ELSE 'ON_SHELF' END AS "shelfStatus",
                       b.updated_at    AS "updatedAt"
                  FROM catalog.book b
                  JOIN catalog.category c ON c.category_id = b.category_id
                 WHERE b.book_id = ? AND b.deleted = false
                """;
        List<Map<String, Object>> rows = jdbc.queryForList(sql, id);
        if (rows.isEmpty()) {
            return ApiResponse.fail("BOOK_NOT_FOUND", "图书不存在", requestId(request));
        }
        Map<String, Object> row = new LinkedHashMap<>(rows.get(0));
        String names = (String) row.get("authorNames");
        row.put("authorNames", names == null || names.isBlank() ? List.of() : List.of(names.split(";")));
        return ApiResponse.ok(row, requestId(request));
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> m = new LinkedHashMap<>();
        try {
            Long n = jdbc.queryForObject("select count(*) from catalog.book", Long.class);
            m.put("status", "UP");
            m.put("books", n);
        } catch (RuntimeException e) {
            m.put("status", "DEGRADED");
            m.put("error", e.getMessage());
        }
        return m;
    }

    private String requestId(HttpServletRequest request) {
        String id = request.getHeader("X-Request-Id");
        return id != null && !id.isBlank() ? id : UUID.randomUUID().toString();
    }
}
