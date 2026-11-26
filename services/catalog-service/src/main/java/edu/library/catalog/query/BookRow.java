package edu.library.catalog.query;

import com.fasterxml.jackson.annotation.JsonIgnore;

import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

/**
 * 检索结果行 = book + category + author(聚合) + media(最新封面) 的一次 JOIN 结果。
 * 字段名与 contracts/catalog-api.md 的 item 结构一一对应。
 */
public class BookRow {

    private Long bookId;
    private String title;
    private String isbn;
    private Long categoryId;
    private String categoryName;
    /** 数据库里是分号拼接的字符串，转成数组后才能直接给前端 */
    private String authorNames;
    private String publisher;
    private Integer publishYear;
    private Boolean hasPdfSource;
    private String summary;
    private Integer totalCopies;
    private String coverUrl;
    private String shelfStatus;
    private LocalDateTime updatedAt;
    /** count(*) OVER() 带出来的全量条数，只用于取 total，不返回给前端 */
    private Long totalCount;

    public List<String> authorNameList() {
        if (authorNames == null || authorNames.isBlank()) {
            return List.of();
        }
        return Arrays.stream(authorNames.split(";"))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .toList();
    }

    public Long getBookId() {
        return bookId;
    }

    public void setBookId(Long bookId) {
        this.bookId = bookId;
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public String getIsbn() {
        return isbn;
    }

    public void setIsbn(String isbn) {
        this.isbn = isbn;
    }

    public Long getCategoryId() {
        return categoryId;
    }

    public void setCategoryId(Long categoryId) {
        this.categoryId = categoryId;
    }

    public String getCategoryName() {
        return categoryName;
    }

    public void setCategoryName(String categoryName) {
        this.categoryName = categoryName;
    }

    public String getAuthorNames() {
        return authorNames;
    }

    public void setAuthorNames(String authorNames) {
        this.authorNames = authorNames;
    }

    public String getPublisher() {
        return publisher;
    }

    public void setPublisher(String publisher) {
        this.publisher = publisher;
    }

    public Integer getPublishYear() {
        return publishYear;
    }

    public void setPublishYear(Integer publishYear) {
        this.publishYear = publishYear;
    }

    public Boolean getHasPdfSource() { return hasPdfSource; }

    public void setHasPdfSource(Boolean hasPdfSource) { this.hasPdfSource = hasPdfSource; }

    public String getSummary() {
        return summary;
    }

    public void setSummary(String summary) {
        this.summary = summary;
    }

    public String getCoverUrl() {
        return coverUrl;
    }

    public void setCoverUrl(String coverUrl) {
        this.coverUrl = coverUrl;
    }

    public String getShelfStatus() {
        return shelfStatus;
    }

    public void setShelfStatus(String shelfStatus) {
        this.shelfStatus = shelfStatus;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    /** 分页用的内部字段，不进响应体 */
    @JsonIgnore
    public Long getTotalCount() {
        return totalCount;
    }
    public void setTotalCount(Long totalCount) {
        this.totalCount = totalCount;
    }

    /** 馆藏册数（catalog.book.total_copies，馆员登记的计划册数） */
    public Integer getTotalCopies() {
        return totalCopies;
    }
    public void setTotalCopies(Integer totalCopies) {
        this.totalCopies = totalCopies;
    }
}
