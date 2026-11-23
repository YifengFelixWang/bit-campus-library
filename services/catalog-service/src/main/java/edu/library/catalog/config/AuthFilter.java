package edu.library.catalog.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

/**
 * 把 Bearer token 解析成四种应用角色之一，并做接口级鉴权。
 *
 * 角色与数据库账号的对应关系以 D 的《03-账号对照.md》为准：
 *   读者 → db_catalog_reader01/02（只读），馆员 → db_catalog_librarian01（读写）。
 *   数据分析员、运维管理员不访问本服务的业务数据，只放行 whoami 与 ops/status。
 *
 * 注意：RoleContext 用 ThreadLocal 存角色，线程会被复用，必须在 finally 里 clear，
 * 否则上一个请求的角色会泄漏到下一个请求。
 */
@Component
@Order(1)
public class AuthFilter extends OncePerRequestFilter {

    private static final List<String> ANALYST_OPS_ALLOWED = List.of(
            "/api/catalog/whoami",
            "/api/catalog/ops/status"
    );

    private final IdentityClient identityClient;

    public AuthFilter(IdentityClient identityClient) {
        this.identityClient = identityClient;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        RoleContext.AppRole role = RoleContext.AppRole.READER;
        String username = null;
        Long userId = null;
        if (header != null) {
            if (!header.startsWith("Bearer ") || header.substring(7).isBlank()) {
                response.sendError(401);
                return;
            }
            try {
                var identity = identityClient.resolve(header);
                if (identity == null || identity.username() == null || identity.roles() == null || identity.id() <= 0) {
                    response.sendError(401);
                    return;
                }
                username = identity.username();
                userId = identity.id();
                role = mapRole(identity.roles());
            } catch (org.springframework.web.client.HttpClientErrorException.Unauthorized e) {
                response.sendError(401);
                return;
            } catch (org.springframework.web.client.RestClientException e) {
                response.sendError(503);
                return;
            }
        }
        RoleContext.set(role, username, userId);
        try {
            String path = request.getRequestURI();
            String method = request.getMethod().toUpperCase();

            if (path.startsWith("/api/catalog/")) {
                // 1) 分析员与运维：允许浏览书目（GET），不允许写；仅这两个接口例外放行写
                if (role == RoleContext.AppRole.ANALYST || role == RoleContext.AppRole.OPS) {
                    boolean read = "GET".equals(method);
                    if (!read && !ANALYST_OPS_ALLOWED.contains(path)) {
                        deny(response, "当前角色只能浏览，不能维护书目");
                        return;
                    }
                }

                // 2) 读者与匿名：只读；例外是登录后发表评价
                boolean isWrite = !"GET".equals(method);
                boolean reviewWrite = "POST".equals(method) && "/api/catalog/reviews".equals(path) && userId != null;
                if (isWrite && role == RoleContext.AppRole.READER && !reviewWrite) {
                    deny(response, "需要馆员身份");
                    return;
                }
            }

            chain.doFilter(request, response);
        } finally {
            RoleContext.clear();
        }
    }

    private RoleContext.AppRole mapRole(List<String> roles) {
        if (roles.contains("LIBRARIAN")) return RoleContext.AppRole.LIBRARIAN;
        if (roles.contains("ANALYST")) return RoleContext.AppRole.ANALYST;
        if (roles.contains("OPERATOR") || roles.contains("OPS")) return RoleContext.AppRole.OPS;
        // 兼容历史令牌：ADMIN 视作馆员
        if (roles.contains("ADMIN")) return RoleContext.AppRole.LIBRARIAN;
        return RoleContext.AppRole.READER;
    }

    private void deny(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write("{\"code\":\"FORBIDDEN\",\"message\":\"" + message + "\"}");
    }
}
