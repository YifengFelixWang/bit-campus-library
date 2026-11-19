package edu.library.catalog.query;

import edu.library.catalog.common.ApiException;

/**
 * 排序字段白名单。
 *
 * 这是整套实现里最关键的一道防线：ORDER BY 的列名不能走 JDBC 参数绑定，
 * 只能拼进 SQL 字符串，所以「用户传什么就拼什么」必然导致注入。
 * 做法是只认这里枚举的 apiName，转成固定的列名后再拼。
 *
 * 新增可排序字段 = 改这一个枚举，别处不允许再出现列名字符串。
 */
public enum BookSortField {

    UPDATED_AT("updatedAt", "b.updated_at"),
    TITLE("title", "b.title"),
    PUBLISH_YEAR("publishYear", "b.publish_year"),
    BOOK_ID("bookId", "b.book_id");

    private final String apiName;
    private final String column;

    BookSortField(String apiName, String column) {
        this.apiName = apiName;
        this.column = column;
    }

    public String apiName() {
        return apiName;
    }

    /** 只允许内部拼 SQL 使用，绝不接受外部输入 */
    public String column() {
        return column;
    }

    public static BookSortField of(String apiName) {
        if (apiName == null || apiName.isBlank()) {
            return UPDATED_AT;
        }
        for (BookSortField f : values()) {
            if (f.apiName.equalsIgnoreCase(apiName.trim())) {
                return f;
            }
        }
        // 未知字段直接拒绝，不回退到默认值——静默回退会让前端以为排序生效了
        throw new ApiException("INVALID_SORT_FIELD", "不支持的排序字段：" + apiName, 400);
    }
}
