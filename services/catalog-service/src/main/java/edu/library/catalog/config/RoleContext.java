package edu.library.catalog.config;

/**
 * 当前请求的应用角色（由 AuthFilter 写入，请求结束清除）。
 *
 * 角色定义以 D 的《03-账号对照.md》《使用说明-全组.md》为准，只有四种：
 *   读者 READER        —— 查询书目、看封面、申请借阅、看个人记录
 *   馆员 LIBRARIAN     —— 维护书目与副本、办理借还、导入书目
 *   数据分析员 ANALYST —— 多条件查询、导入导出（数据来自 report schema，本服务不提供）
 *   运维管理员 OPS     —— 查看数据库状态、备份恢复、主备切换（dbops 服务提供）
 *
 * 本服务（catalog）只服务读者与馆员；分析员、运维访问 /api/catalog/** 一律 403，
 * 只有 /api/catalog/whoami、/api/catalog/ops/status 例外。
 */
public final class RoleContext {

    public enum AppRole { READER, LIBRARIAN, ANALYST, OPS }

    private static final ThreadLocal<AppRole> ROLE = new ThreadLocal<>();
    private static final ThreadLocal<String> USERNAME = new ThreadLocal<>();
    private static final ThreadLocal<Long> USER_ID = new ThreadLocal<>();

    private RoleContext() {
    }

    public static void set(AppRole role, String username, Long userId) {
        ROLE.set(role);
        USERNAME.set(username);
        USER_ID.set(userId);
    }

    public static AppRole role() {
        AppRole r = ROLE.get();
        return r == null ? AppRole.OPS : r;   // 无令牌按最小权限处理
    }

    public static String username() {
        return USERNAME.get();
    }

    public static Long userId() {
        return USER_ID.get();
    }

    /** 数据源路由键：读者走 reader01，馆员走 librarian01（D 的对照表） */
    public static String dbKey() {
        if (role() == AppRole.LIBRARIAN) return "librarian";
        if ("reader02".equals(username())) return "reader02";
        return "reader";
    }

    public static void clear() {
        ROLE.remove();
        USERNAME.remove();
        USER_ID.remove();
    }
}
