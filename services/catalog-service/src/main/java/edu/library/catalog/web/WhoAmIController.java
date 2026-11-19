package edu.library.catalog.web;

import edu.library.catalog.config.RoleContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 身份自证接口。答辩时最有说服力的一屏：
 * 同一个服务，登录不同应用账号，这里显示的数据库用户不同。
 */
@RestController
@RequestMapping("/api/catalog")
public class WhoAmIController {

    private final JdbcTemplate jdbc;

    public WhoAmIController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/whoami")
    public Map<String, Object> whoami() {
        Map<String, Object> out = new LinkedHashMap<>();
        String username = RoleContext.username();
        if (username == null) {
            out.put("code", "UNAUTHORIZED");
            out.put("message", "缺少或无效的 Authorization 令牌");
            return out;
        }
        out.put("username", username);
        out.put("appRole", RoleContext.role().name());

        // 分析员与运维按读者权限浏览书目，连的是读者账号，这里照实反映
        List<Map<String, Object>> rows = jdbc.queryForList(
                "select current_user as \"currentUser\", session_user as \"sessionUser\"");
        out.put("database", rows.isEmpty() ? Map.of() : rows.get(0));
        out.put("poolKey", RoleContext.dbKey());
        if (RoleContext.role() == RoleContext.AppRole.ANALYST
                || RoleContext.role() == RoleContext.AppRole.OPS) {
            out.put("note", "本角色以读者权限浏览书目；报表 / 运维能力由 report、dbops 服务提供");
        }
        return out;
    }
}
