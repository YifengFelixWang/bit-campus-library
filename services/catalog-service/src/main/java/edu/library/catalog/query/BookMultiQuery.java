package edu.library.catalog.query;

import edu.library.catalog.common.ApiException;

/**
 * 多条件联动检索条件（「全部图书」页的多条件查询用）。
 *
 * 与 {@link BookQuery} 的区别：
 *   - BookQuery 是单关键词检索（书名/ISBN/出版社/作者 OR 在一起），首页、控制台、管理页都在用，
 *     不能动它的语义；
 *   - 这里是「每个条件各自生效、彼此 AND」的多条件表单，标题、作者、出版社、年份区间
 *     分别对应 book / author(book_author) / book.publisher / book.publish_year。
 *
 * 同样只有一个入口 {@link #of}：进到这里之后所有字段都可信，
 * 排序字段已由 {@link BookSortField} 白名单转成列名，分页已夹到合法区间。
 */
public final class BookMultiQuery {

    private static final int DEFAULT_SIZE = 12;
    private static final int MAX_SIZE = 100;
    private static final int MIN_YEAR = 1000;
    private static final int MAX_YEAR = 2100;

    private final String title;
    private final String author;
    private final String publisher;
    private final String isbn;
    private final Long categoryId;
    private final Integer yearFrom;
    private final Integer yearTo;
    /** null 表示上下架都要（"ALL"）；否则 ON_SHELF / OFF_SHELF */
    private final String status;
    /** null 表示不限制；true/false 对应「本地有 PDF 原文件 / 没有」 */
    private final Boolean hasPdfSource;
    private final String sortBy;
    private final String sortColumn;
    private final String orderDirection;
    private final int page;
    private final int size;
    private final int offset;

    private BookMultiQuery(String title, String author, String publisher, String isbn, Long categoryId,
                           Integer yearFrom, Integer yearTo, String status, Boolean hasPdfSource,
                           String sortBy, String sortColumn, String orderDirection,
                           int page, int size) {
        this.title = title;
        this.author = author;
        this.publisher = publisher;
        this.isbn = isbn;
        this.categoryId = categoryId;
        this.yearFrom = yearFrom;
        this.yearTo = yearTo;
        this.status = status;
        this.hasPdfSource = hasPdfSource;
        this.sortBy = sortBy;
        this.sortColumn = sortColumn;
        this.orderDirection = orderDirection;
        this.page = page;
        this.size = size;
        this.offset = (page - 1) * size;
    }

    public static BookMultiQuery of(String title, String author, String publisher, String isbn,
                                    Long categoryId, Integer yearFrom, Integer yearTo, String status, Boolean hasPdfSource,
                                    String sortBy, String sortOrder, Integer page, Integer size) {

        String t = text(title, "书名");
        String a = text(author, "作者");
        String p = text(publisher, "出版社");
        String i = text(isbn, "ISBN");

        if (categoryId != null && categoryId < 1) {
            throw new ApiException("INVALID_ARGUMENT", "分类编号应为正整数", 400);
        }

        Integer from = year(yearFrom, "起始年份");
        Integer to = year(yearTo, "截止年份");
        if (from != null && to != null && from > to) {
            throw new ApiException("INVALID_ARGUMENT", "起始年份不能大于截止年份", 400);
        }

        String st = status == null ? null : status.trim().toUpperCase();
        if (st != null && (st.isEmpty() || st.equals("ALL"))) {
            st = null;                       // 上下架都要：不拼 deleted 条件
        } else if (st != null && !st.equals("ON_SHELF") && !st.equals("OFF_SHELF")) {
            throw new ApiException("INVALID_ARGUMENT", "status 只能是 ON_SHELF / OFF_SHELF / ALL", 400);
        }

        BookSortField sortField = BookSortField.of(sortBy);
        String dir = "asc".equalsIgnoreCase(sortOrder == null ? "" : sortOrder.trim()) ? "ASC" : "DESC";

        int pg = page == null || page < 1 ? 1 : page;
        int sz = size == null || size < 1 ? DEFAULT_SIZE : Math.min(size, MAX_SIZE);

        return new BookMultiQuery(t, a, p, i, categoryId, from, to, st, hasPdfSource,
                sortField.apiName(), sortField.column(), dir, pg, sz);
    }

    private static String text(String raw, String label) {
        if (raw == null) {
            return null;
        }
        String v = raw.trim();
        if (v.isEmpty()) {
            return null;
        }
        if (v.length() > 100) {
            throw new ApiException("INVALID_ARGUMENT", label + "长度不能超过 100", 400);
        }
        return v;
    }

    private static Integer year(Integer raw, String label) {
        if (raw == null) {
            return null;
        }
        if (raw < MIN_YEAR || raw > MAX_YEAR) {
            throw new ApiException("INVALID_ARGUMENT", label + "应在 " + MIN_YEAR + "–" + MAX_YEAR + " 之间", 400);
        }
        return raw;
    }

    public String getTitle() {
        return title;
    }

    public String getAuthor() {
        return author;
    }

    public String getPublisher() {
        return publisher;
    }

    public String getIsbn() {
        return isbn;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public Integer getYearFrom() {
        return yearFrom;
    }

    public Integer getYearTo() {
        return yearTo;
    }

    public String getStatus() {
        return status;
    }

    public Boolean getHasPdfSource() {
        return hasPdfSource;
    }

    public String getSortBy() {
        return sortBy;
    }

    /** 已是合法列名，只允许内部拼 SQL 使用 */
    public String getSortColumn() {
        return sortColumn;
    }

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

    /** 本次查询实际生效的条件个数，前端用来显示「已应用 N 个条件」 */
    public int effectiveConditions() {
        int n = 0;
        if (title != null) n++;
        if (author != null) n++;
        if (publisher != null) n++;
        if (isbn != null) n++;
        if (categoryId != null) n++;
        if (yearFrom != null || yearTo != null) n++;
        if (status != null) n++;
        return n;
    }
}
