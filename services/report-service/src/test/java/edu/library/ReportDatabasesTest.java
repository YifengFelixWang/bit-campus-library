package edu.library;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReportDatabasesTest {
  @Test
  void specificPasswordWins() {
    MockEnvironment env = new MockEnvironment()
        .withProperty("REPORT_DB_ANALYST_PASSWORD", "analyst-secret")
        .withProperty("LIBRARY_LOCAL_PASSWORD", "shared-secret");
    assertEquals("analyst-secret", ReportDatabases.password(env, "REPORT_DB_ANALYST_PASSWORD"));
  }

  @Test
  void missingPasswordUsesShared() {
    MockEnvironment env = new MockEnvironment().withProperty("LIBRARY_LOCAL_PASSWORD", "shared-secret");
    assertEquals("shared-secret", ReportDatabases.password(env, "REPORT_DB_SYNC_PASSWORD"));
  }

  @Test
  void blankPasswordUsesShared() {
    MockEnvironment env = new MockEnvironment()
        .withProperty("REPORT_DB_SYNC_PASSWORD", " ")
        .withProperty("LIBRARY_LOCAL_PASSWORD", "shared-secret");
    assertEquals("shared-secret", ReportDatabases.password(env, "REPORT_DB_SYNC_PASSWORD"));
  }

  @Test
  void missingSharedPasswordIsEmpty() {
    assertEquals("", ReportDatabases.password(new MockEnvironment(), "REPORT_DB_ANALYST_PASSWORD"));
  }

  @Test
  void jdbcUrlDefaultsAndCanBeOverridden() {
    assertEquals(ReportDatabases.DEFAULT_JDBC_URL, ReportDatabases.jdbcUrl(new MockEnvironment()));
    MockEnvironment env = new MockEnvironment()
        .withProperty("LIBRARY_JDBC_URL", "jdbc:opengauss://db.example:15432/library");
    assertEquals("jdbc:opengauss://db.example:15432/library", ReportDatabases.jdbcUrl(env));
    MockEnvironment blank = new MockEnvironment().withProperty("LIBRARY_JDBC_URL", " ");
    assertEquals(ReportDatabases.DEFAULT_JDBC_URL, ReportDatabases.jdbcUrl(blank));
  }
}
