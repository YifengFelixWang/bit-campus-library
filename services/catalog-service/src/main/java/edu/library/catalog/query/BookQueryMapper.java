package edu.library.catalog.query;

import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 两条通道指向同一份结果结构：
 *   - searchBySql / countBySql：后端动态组装 SQL（默认）
 *   - searchByProc / countByProc：调用数据库存储过程
 * 两者可随时切换，用于性能对比与降级。
 */
public interface BookQueryMapper {

    /** 动态 SQL 分页查询 */
    List<BookRow> searchBySql(@Param("q") BookQuery q);

    /** 动态 SQL 精确总数（只在需要时才调用） */
    long countBySql(@Param("q") BookQuery q);

    /** 存储过程分页查询：SELECT * FROM catalog.fn_search_books(...) */
    List<BookRow> searchByProc(@Param("q") BookQuery q);

    /** 存储过程版 count，仅用于页码越界时补 total */
    long countByProc(@Param("q") BookQuery q);

    /** 多条件联动检索：标题 / 作者 / 出版社 / 分类 / 年份区间 各自生效，AND 连接 */
    List<BookRow> searchMulti(@Param("q") BookMultiQuery q);

    /** 多条件联动检索的总数 */
    long countMulti(@Param("q") BookMultiQuery q);
}
