package edu.library.catalog.query;

import java.util.List;

/**
 * 多条件检索的响应体：在标准分页结构上多带两项元信息。
 *
 *   joinTables        —— 本次查询实际关联的表，前端直接展示「多表联动」用了哪几张表，
 *                        不是为了好看，而是让前端不必硬编码一份可能过期的表清单；
 *   appliedConditions —— 生效的条件个数，前端用来提示「已应用 N 个条件」。
 */
public class MultiSearchResult {

    /** 与 BookQueryMapper.xml 的 bookFrom / bookColumns 保持一致，改 SQL 时同步改这里 */
    public static final List<String> JOIN_TABLES = List.of(
            "catalog.book",
            "catalog.category",
            "catalog.book_author",
            "catalog.author",
            "catalog.media"
    );

    private final int page;
    private final int size;
    private final long total;
    private final int totalPages;
    private final List<BookRow> items;
    private final List<String> joinTables;
    private final int appliedConditions;

    public MultiSearchResult(int page, int size, long total, List<BookRow> items, int appliedConditions) {
        this.page = page;
        this.size = size;
        this.total = total;
        this.totalPages = size <= 0 ? 0 : (int) Math.ceil((double) total / size);
        this.items = items;
        this.joinTables = JOIN_TABLES;
        this.appliedConditions = appliedConditions;
    }

    public int getPage() {
        return page;
    }

    public int getSize() {
        return size;
    }

    public long getTotal() {
        return total;
    }

    public int getTotalPages() {
        return totalPages;
    }

    public List<BookRow> getItems() {
        return items;
    }

    public List<String> getJoinTables() {
        return joinTables;
    }

    public int getAppliedConditions() {
        return appliedConditions;
    }
}
