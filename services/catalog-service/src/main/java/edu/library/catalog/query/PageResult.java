package edu.library.catalog.query;

import java.util.List;

/** 契约统一分页结构：page / size / total / totalPages / items */
public class PageResult<T> {

    private final int page;
    private final int size;
    private final long total;
    private final int totalPages;
    private final List<T> items;

    public PageResult(int page, int size, long total, List<T> items) {
        this.page = page;
        this.size = size;
        this.total = total;
        this.totalPages = size <= 0 ? 0 : (int) Math.ceil((double) total / size);
        this.items = items;
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

    public List<T> getItems() {
        return items;
    }
}
