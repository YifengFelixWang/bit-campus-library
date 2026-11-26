package edu.library.catalog.web;

import edu.library.catalog.common.ApiResponse;
import edu.library.catalog.query.BookMultiQuery;
import edu.library.catalog.query.BookQuery;
import edu.library.catalog.query.BookSearchService;
import edu.library.catalog.query.MultiSearchResult;
import edu.library.catalog.query.PageResult;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * GET /api/catalog/books
 *
 * 控制器只做两件事：收参数、包响应。所有条件归一化在 BookQuery.of 里，
 * 所有 SQL 在 Mapper 里，控制器不出现任何 SQL 字符串。
 */
@RestController
@RequestMapping("/api/catalog")
public class BookController {

    private final BookSearchService searchService;

    public BookController(BookSearchService searchService) {
        this.searchService = searchService;
    }

    @GetMapping("/books")
    public ResponseEntity<ApiResponse<PageResult<?>>> list(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean hasPdf,
            @RequestParam(required = false, defaultValue = "updatedAt") String sortBy,
            @RequestParam(required = false, defaultValue = "desc") String sortOrder,
            @RequestParam(required = false, defaultValue = "1") Integer page,
            @RequestParam(required = false, defaultValue = "10") Integer size,
            HttpServletRequest request) {

        // 唯一入口：进这里之后参数都是可信的
        BookQuery q = BookQuery.of(keyword, categoryId, status, sortBy, sortOrder, page, size);
        PageResult<?> result = searchService.search(q);
        return ResponseEntity.ok(ApiResponse.ok(result, requestId(request)));
    }

    /**
     * GET /api/catalog/books/search —— 多条件联动查询（「全部图书」页的多条件表单）
     *
     * 与 /books 的区别：/books 是单关键词检索，这里是每个条件各自生效、AND 连接。
     * 一次请求会关联 5 张表：
     *    catalog.book（主表）
     *    catalog.category（分类名，INNER JOIN）
     *    catalog.book_author + catalog.author（作者聚合，EXISTS 过滤 / string_agg 输出）
     *    catalog.media（最新封面）
     *
     * 所有条件都是可选的，不传就是「不限」；排序字段走 BookSortField 白名单，
     * 未知字段直接 400，不静默回退。
     */
    @GetMapping("/books/search")
    public ResponseEntity<ApiResponse<MultiSearchResult>> search(
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String author,
            @RequestParam(required = false) String publisher,
            @RequestParam(required = false) String isbn,
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) Integer yearFrom,
            @RequestParam(required = false) Integer yearTo,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Boolean hasPdf,
            @RequestParam(required = false, defaultValue = "updatedAt") String sortBy,
            @RequestParam(required = false, defaultValue = "desc") String sortOrder,
            @RequestParam(required = false, defaultValue = "1") Integer page,
            @RequestParam(required = false, defaultValue = "12") Integer size,
            HttpServletRequest request) {

        BookMultiQuery q = BookMultiQuery.of(title, author, publisher, isbn, categoryId,
                yearFrom, yearTo, status, hasPdf, sortBy, sortOrder, page, size);
        MultiSearchResult result = searchService.searchMulti(q);
        return ResponseEntity.ok(ApiResponse.ok(result, requestId(request)));
    }

    private String requestId(HttpServletRequest request) {
        String id = request.getHeader("X-Request-Id");
        return id != null && !id.isBlank() ? id : UUID.randomUUID().toString();
    }
}
