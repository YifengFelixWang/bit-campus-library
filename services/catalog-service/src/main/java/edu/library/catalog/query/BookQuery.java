package edu.library.catalog.query;

import edu.library.catalog.common.ApiException;

/**
 * 归一化之后的检索条件。
 *
 * 外部参数只经过 {@link #of} 一个入口，进去之后所有字段都是「可信」的：
 * 分页被夹在合法区间、排序字段已转成列名、方向只可能是 ASC/DESC。
 * 后续拼 SQL 直接取 sortColumn / orderDirection，不需要再校验一次。
 */
public final class BookQuery {

    private static final int DEFAULT_SIZE = 10;
    private static final int MAX_SIZE = 100;

    private final String keyword;
    private final Long categoryId;
    private final String status;
    private final String sortBy;
    private final String sortColumn;
    private final String orderDirection;
    private final int page;
    private final int size;
    private final int offset;

    private BookQuery(String keyword, Long categoryId, String status, String sortBy,
                      String sortColumn, String orderDirection, int page, int size) {
        this.keyword = keyword;
        this.categoryId = categoryId;
        this.status = status;
        this.sortBy = sortBy;
        this.sortColumn = sortColumn;
        this.orderDirection = orderDirection;
        this.page = page;
        this.size = size;
        this.offset = (page - 1) * size;
    }

    public static BookQuery of(String keyword, Long categoryId, String status,
                               String sortBy, String sortOrder, Integer page, Integer size) {

        String kw = keyword == null ? null : keyword.trim();
        if (kw != null && kw.isEmpty()) {
            kw = null;
        }
        if (kw != null && kw.length() > 100) {
            throw new ApiException("INVALID_ARGUMENT", "关键词长度不能超过 100", 400);
        }

        String st = status == null ? null : status.trim().toUpperCase();
        if (st != null && st.isEmpty()) {
            st = null;
        }
        if (st != null && !st.equals("ON_SHELF") && !st.equals("OFF_SHELF")) {
            throw new ApiException("INVALID_ARGUMENT", "status 只能是 ON_SHELF / OFF_SHELF", 400);
        }

        BookSortField sortField = BookSortField.of(sortBy);
        String dir = "asc".equalsIgnoreCase(sortOrder == null ? "" : sortOrder.trim()) ? "ASC" : "DESC";

        int p = page == null || page < 1 ? 1 : page;
        int s = size == null || size < 1 ? DEFAULT_SIZE : Math.min(size, MAX_SIZE);

        return new BookQuery(kw, categoryId, st, sortField.apiName(),
                sortField.column(), dir, p, s);
    }

    public String getKeyword() {
        return keyword;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public String getStatus() {
        return status;
    }

    /** 给存储过程用：过程内部再做一次白名单校验，双保险 */
    public String getSortBy() {
        return sortBy;
    }

    /** 给动态 SQL 用：已是合法列名 */
    public String getSortColumn() {
        return sortColumn;
    }

    /** 只会是 ASC 或 DESC */
    public String getOrderDirection() {
        return orderDirection;
    }

    public int getPage() {
        return page;
    }

    public int getSize() {
        return size;
    }

    public int getOffset() {
        return offset;
    }
}
