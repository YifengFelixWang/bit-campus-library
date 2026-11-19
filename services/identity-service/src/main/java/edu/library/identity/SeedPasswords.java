package edu.library.identity;

import java.util.Map;
import java.util.Locale;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
class SeedPasswords implements ApplicationRunner {
    private static final Map<String, Integer> DEMOS = Map.of(
            "reader01", 1, "reader02", 2, "librarian01", 3, "analyst01", 4);
    private final JdbcTemplate jdbc;
    private final Environment environment;
    private final Passwords passwords;

    SeedPasswords(JdbcTemplate jdbc, Environment environment, Passwords passwords) {
        this.jdbc = jdbc;
        this.environment = environment;
        this.passwords = passwords;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        for (var demo : DEMOS.entrySet()) {
            String setting = "IAM_SEED_" + demo.getKey().toUpperCase(Locale.ROOT) + "_PASSWORD";
            String password = environment.getProperty(setting);
            if (password == null) continue;
            if (password.isBlank() || password.length() < 12 || password.length() > 256) {
                throw new IllegalStateException(setting + " must contain between 12 and 256 characters");
            }
            var existing = jdbc.queryForList(
                    "SELECT password_hash FROM iam.app_user WHERE user_id = ? AND username = ?",
                    String.class, demo.getValue(), demo.getKey());
            if (existing.isEmpty()) {
                throw new IllegalStateException("Missing IAM demo user " + demo.getKey() + ". Import D's seed first.");
            }
            if ("REPLACE_WITH_HASH".equals(existing.getFirst())) {
                jdbc.update("""
                    UPDATE iam.app_user SET password_hash = ?, updated_at = LOCALTIMESTAMP
                    WHERE user_id = ? AND username = ? AND password_hash = 'REPLACE_WITH_HASH'
                    """, passwords.encode(password), demo.getValue(), demo.getKey());
            }
        }
    }
}
