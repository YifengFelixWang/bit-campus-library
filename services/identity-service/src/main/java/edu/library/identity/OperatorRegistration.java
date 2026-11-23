package edu.library.identity;

import java.util.List;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Local provisioning command. Boot supplies the same datasource settings as the identity service. */
@EnableAutoConfiguration
class OperatorRegistration {
    static void run(String[] args) {
        String password = System.getenv("IAM_REGISTER_OPS1_PASSWORD");
        if (password == null || password.isBlank() || password.length() < 12 || password.length() > 256) {
            throw new IllegalArgumentException("IAM_REGISTER_OPS1_PASSWORD must contain 12 to 256 characters");
        }
        try (var context = new SpringApplicationBuilder(OperatorRegistration.class)
                .web(WebApplicationType.NONE).run(args)) {
            var jdbc = context.getBean(JdbcTemplate.class);
            var transaction = context.getBean(TransactionTemplate.class);
            String result = transaction.execute(status -> register(jdbc, password));
            System.out.println(result);
        }
    }

    private static String register(JdbcTemplate jdbc, String password) {
        // D's schema assigns IDs in application code. Serialize allocation with other account inserts.
        jdbc.execute("LOCK TABLE iam.app_user IN SHARE ROW EXCLUSIVE MODE");
        var existing = jdbc.queryForList("SELECT user_id FROM iam.app_user WHERE username = 'ops1'", Long.class);
        if (!existing.isEmpty()) {
            var user = new IamUsers(jdbc).enabledUser(existing.getFirst());
            if (user.isEmpty() || !user.get().roles().equals(List.of("OPERATOR"))) {
                throw new IllegalStateException("OPS1_CONFLICT");
            }
            return "OPS1_ALREADY_REGISTERED";
        }
        Long roleId = jdbc.queryForObject("SELECT role_id FROM iam.app_role WHERE role_code = 'OPERATOR'", Long.class);
        Long userId = jdbc.queryForObject("SELECT COALESCE(MAX(user_id), 0) + 1 FROM iam.app_user", Long.class);
        jdbc.update("""
                INSERT INTO iam.app_user (user_id, username, password_hash, display_name, enabled, updated_at, deleted)
                VALUES (?, 'ops1', ?, '运维管理员', TRUE, LOCALTIMESTAMP, FALSE)
                """, userId, new Passwords().encode(password));
        jdbc.update("INSERT INTO iam.user_role (user_id, role_id) VALUES (?, ?)", userId, roleId);
        return "OPS1_CREATED";
    }
}
