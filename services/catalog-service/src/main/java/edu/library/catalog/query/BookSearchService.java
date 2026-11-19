package edu.library.catalog.query;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.logging.Logger;

/**
 * 检索编排层：只做三件事——
 *   1. 选择通道（动态 SQL / 存储过程）；
 *   2. 决定 total 怎么拿（尽量少查一次 count）；
 *   3. 兜住边界情况（页码越界、过程返回空结果）。
 * 不在这里拼任何 SQL 片段。
 */
@Service
public class BookSearchService {

    private static final Logger log = Logger.getLogger(BookSearchService.class.getName());

    private final BookQueryMapper mapper;
    private final String mode;

    public BookSearchService(BookQueryMapper mapper,
                             @Value("${catalog.search.mode:sql}") String mode) {
        this.mapper = mapper;
        this.mode = mode.trim().toLowerCase();
    }

    public PageResult<BookRow> search(BookQuery q) {
        return "proc".equals(mode) ? searchByProc(q) : searchBySql(q);
    }

    /**
     * 多条件联动检索。
     *
     * 只走动态 SQL 通道，不上存储过程：多条件表单要能分别按 标题 / 作者 / 出版社 /
     * 年份区间 过滤，而 catalog.fn_search_books 的签名是单关键词 + 分类 + 状态，
     * 硬塞进去要么改过程签名（牵动已验收的接口），要么在过程里再拼一遍动态 SQL
     * （等于把注入风险搬进 PL/pgSQL）。这里保持「一个条件一个 <if>」，语义最清楚。
     */
    public MultiSearchResult searchMulti(BookMultiQuery q) {
        List<BookRow> rows = mapper.searchMulti(q);

        // 同 searchBySql：本页没填满就说明是末页，total 不用再 count 一次
        long total = rows.size() < q.getSize()
                ? (long) q.getOffset() + rows.size()
                : mapper.countMulti(q);

        return new MultiSearchResult(q.getPage(), q.getSize(), total, rows, q.effectiveConditions());
    }

    /** 通道 A：动态 SQL。条件由 MyBatis 拼，排序已由枚举转成常量。 */
    private PageResult<BookRow> searchBySql(BookQuery q) {
        List<BookRow> rows = mapper.searchBySql(q);

        // 能不算 count 就不算：
        //   - 结果未填满一页 → total = 已翻过的条数 + 本页条数（就是末页，无需再查）
        //   - 填满一页 → 才真正 count 一次
        long total;
        if (rows.size() < q.getSize()) {
            total = (long) q.getOffset() + rows.size();
        } else {
            total = mapper.countBySql(q);
        }
        return new PageResult<>(q.getPage(), q.getSize(), total, rows);
    }

    /**
     * 通道 B：存储过程。total 由 count(*) OVER() 随结果一起返回。
     *
     * 已知边界：结果为空时窗口函数没有行可附，拿不到 total。
     *   - 第 1 页为空 → 确实没有数据，total = 0
     *   - 第 N 页为空 → 可能是页码越界，必须补一次 count，否则前端会以为总共 0 条
     */
    private PageResult<BookRow> searchByProc(BookQuery q) {
        List<BookRow> rows;
        try {
            rows = mapper.searchByProc(q);
        } catch (RuntimeException e) {
            // 存储过程不可用（未部署 / 权限不足 / 语法不兼容）时退回动态 SQL，
            // 保证检索功能不整体挂掉；日志留痕便于发现过程没装
            log.warning("存储过程检索失败，回退动态 SQL：" + e.getMessage());
            return searchBySql(q);
        }

        long total;
        if (!rows.isEmpty() && rows.get(0).getTotalCount() != null) {
            total = rows.get(0).getTotalCount();
        } else if (q.getPage() > 1) {
            total = mapper.countByProc(q);
        } else {
            total = 0;
        }
        return new PageResult<>(q.getPage(), q.getSize(), total, rows);
    }
}
