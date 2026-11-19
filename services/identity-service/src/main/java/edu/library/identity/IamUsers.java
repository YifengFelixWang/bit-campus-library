package edu.library.identity;

import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
class IamUsers {
    record Credential(long id, String passwordHash) {}
    record User(long id, String username, List<String> roles) {}

    private final JdbcTemplate jdbc;

    IamUsers(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    Optional<Credential> enabledCredential(String username) {
        return jdbc.query("""
                SELECT user_id, password_hash FROM iam.app_user
                WHERE username = ? AND enabled = TRUE AND deleted = FALSE
                """, (rs, row) -> new Credential(rs.getLong(1), rs.getString(2)), username).stream().findFirst();
    }

    Optional<User> enabledUser(long id) {
        return jdbc.query("""
                SELECT u.user_id, u.username, r.role_code
                FROM iam.app_user u
                LEFT JOIN iam.user_role ur ON ur.user_id = u.user_id
                LEFT JOIN iam.app_role r ON r.role_id = ur.role_id
                WHERE u.user_id = ? AND u.enabled = TRUE AND u.deleted = FALSE
                ORDER BY r.role_code
                """, rs -> {
                    if (!rs.next()) return Optional.empty();
                    String username = rs.getString("username");
                    var roles = new java.util.ArrayList<String>();
                    do {
                        String role = rs.getString("role_code");
                        if (role != null) roles.add(role);
                    } while (rs.next());
                    return Optional.of(new User(id, username, List.copyOf(roles)));
                }, id);
    }
}
