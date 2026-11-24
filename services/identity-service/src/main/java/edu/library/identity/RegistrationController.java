package edu.library.identity;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 读者自助注册。
 *
 * 只开 READER 一个角色：公开接口不能造运维号，否则前面做的权限分层会被一句话绕开。
 * 用户 id 仍按 D 的约定在应用层分配，并用与 OperatorRegistration 相同的表锁串行化，
 * 避免两个人同时注册时拿到同一个 MAX(user_id)+1。
 */
@RestController
class RegistrationController {
    record Register(String username, String password, String displayName) {}
    record Created(long userId, String username, String displayName) {}

    private static final int MAX_PER_MINUTE = 5;
    private final Map<String, long[]> windows = new ConcurrentHashMap<>();
    private final JdbcTemplate jdbc;
    private final Passwords passwords;
    private final TransactionTemplate transaction;

    RegistrationController(JdbcTemplate jdbc, Passwords passwords, TransactionTemplate transaction) {
        this.jdbc = jdbc;
        this.passwords = passwords;
        this.transaction = transaction;
    }

    @PostMapping("/auth/register")
    ResponseEntity<Created> register(@RequestBody Register body, HttpServletRequest request) {
        String username = body.username() == null ? "" : body.username().trim();
        String password = body.password() == null ? "" : body.password();
        String displayName = body.displayName() == null ? "" : body.displayName().trim();

        if (!username.matches("[A-Za-z][A-Za-z0-9_]{2,31}")
                || password.length() < 8 || password.length() > 128
                || displayName.length() > 40) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "用户名或密码不符合要求");
        }
        if (displayName.isEmpty()) displayName = username;
        throttle(request);

        // lambda 里要用 effectively final 的值，这里固定一份
        final String finalUsername = username;
        final String finalDisplayName = displayName;
        final String finalPassword = password;

        try {
            Created created = transaction.execute(status -> {
                jdbc.execute("LOCK TABLE iam.app_user IN SHARE ROW EXCLUSIVE MODE");
                var exists = jdbc.queryForList("SELECT 1 FROM iam.app_user WHERE username = ?", Integer.class, finalUsername);
                if (!exists.isEmpty()) {
                    throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已被占用");
                }
                Long roleId = jdbc.queryForObject(
                        "SELECT role_id FROM iam.app_role WHERE role_code = 'READER'", Long.class);
                Long userId = jdbc.queryForObject(
                        "SELECT COALESCE(MAX(user_id), 0) + 1 FROM iam.app_user", Long.class);
                jdbc.update("""
                        INSERT INTO iam.app_user (user_id, username, password_hash, display_name, enabled, updated_at, deleted)
                        VALUES (?, ?, ?, ?, TRUE, LOCALTIMESTAMP, FALSE)
                        """, userId, finalUsername, passwords.encode(finalPassword), finalDisplayName);
                jdbc.update("INSERT INTO iam.user_role (user_id, role_id) VALUES (?, ?)", userId, roleId);
                return new Created(userId, finalUsername, finalDisplayName);
            });
            return ResponseEntity.status(HttpStatus.CREATED)
                    .header("Cache-Control", "no-store")
                    .body(created);
        } catch (DuplicateKeyException duplicate) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "用户名已被占用");
        }
    }

    /** 公开接口的兜底限速：同一来源每分钟最多 5 次，避免被当成批量造号入口。 */
    private void throttle(HttpServletRequest request) {
        // 所有请求都经 Nginx，remoteAddr 会是网关地址；真实来源在 X-Real-IP，
        // 否则限速会退化成“全站每分钟 5 次”。Nginx 只在反代时写这个头，外部改不到。
        String forwarded = request.getHeader("X-Real-IP");
        String ip = forwarded == null || forwarded.isBlank() ? request.getRemoteAddr() : forwarded;
        long now = System.currentTimeMillis();
        long[] window = windows.computeIfAbsent(ip, key -> new long[]{now, 0});
        synchronized (window) {
            if (now - window[0] > 60_000L) {
                window[0] = now;
                window[1] = 0;
            }
            if (window[1] >= MAX_PER_MINUTE) {
                throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "注册太频繁，请稍后再试");
            }
            window[1]++;
        }
    }
}
