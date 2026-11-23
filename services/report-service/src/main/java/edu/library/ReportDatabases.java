package edu.library;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** 查询使用分析员账号，同步写入使用同步账号。两个连接池分开。 */
@Component
public class ReportDatabases {
  static final String ANALYST_USER = "db_report_analyst01";
  static final String SYNC_USER = "db_report_sync";
  static final String DEFAULT_JDBC_URL = "jdbc:opengauss://127.0.0.1:15432/library";

  private final HikariDataSource analystPool;
  private final HikariDataSource syncPool;
  private final JdbcTemplate analyst;
  private final JdbcTemplate sync;

  public ReportDatabases(Environment env) {
    String url = jdbcUrl(env);
    analystPool = pool(url, ANALYST_USER, password(env, "REPORT_DB_ANALYST_PASSWORD"), "report-analyst");
    try {
      syncPool = pool(url, SYNC_USER, password(env, "REPORT_DB_SYNC_PASSWORD"), "report-sync");
    } catch (RuntimeException ex) {
      analystPool.close();
      throw ex;
    }
    analyst = template(analystPool);
    sync = template(syncPool);
  }

  public JdbcTemplate analyst() {
    return analyst;
  }

  public JdbcTemplate sync() {
    return sync;
  }

  HikariDataSource analystPool() {
    return analystPool;
  }

  HikariDataSource syncPool() {
    return syncPool;
  }

  static String jdbcUrl(Environment env) {
    String url = env.getProperty("LIBRARY_JDBC_URL");
    if (url == null || url.isBlank()) {
      return DEFAULT_JDBC_URL;
    }
    return url;
  }

  static String password(Environment env, String key) {
    String specific = env.getProperty(key);
    if (specific != null && !specific.isBlank()) {
      return specific;
    }
    String shared = env.getProperty("LIBRARY_LOCAL_PASSWORD");
    if (shared == null || shared.isBlank()) {
      return "";
    }
    return shared;
  }

  private static JdbcTemplate template(HikariDataSource dataSource) {
    JdbcTemplate jdbc = new JdbcTemplate(dataSource);
    jdbc.setQueryTimeout(3);
    return jdbc;
  }

  private static HikariDataSource pool(String url, String user, String password, String name) {
    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(url);
    config.setUsername(user);
    config.setPassword(password);
    config.setDriverClassName("org.opengauss.Driver");
    config.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'");
    config.setMaximumPoolSize(4);
    config.setMinimumIdle(0);
    config.setConnectionTimeout(2000);
    config.setInitializationFailTimeout(-1);
    config.setPoolName(name);
    return new HikariDataSource(config);
  }

  @PreDestroy
  public void close() {
    analystPool.close();
    syncPool.close();
  }
}
