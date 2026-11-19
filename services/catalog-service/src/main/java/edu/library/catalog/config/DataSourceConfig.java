package edu.library.catalog.config;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.util.HashMap;
import java.util.Map;

/**
 * 两个数据库账号各一个连接池，由 RoutingDataSource 按应用角色选择。
 * 账号映射严格按 D 的《03-账号对照.md》：
 *   读者 → db_catalog_reader01（只读）；馆员 → db_catalog_librarian01（增改）。
 * 不走 gaussdb 直连，也不额外建 admin 账号（D 未分配）。
 */
@Configuration
public class DataSourceConfig {

    @Value("${catalog.db.url:jdbc:opengauss://127.0.0.1:15432/library}")
    private String url;

    @Value("${catalog.db.reader.username:db_catalog_reader01}")
    private String readerUser;

    @Value("${catalog.db.reader.password}")
    private String readerPassword;

    @Value("${catalog.db.reader02.password}")
    private String reader02Password;

    @Value("${catalog.db.librarian.username:db_catalog_librarian01}")
    private String librarianUser;

    @Value("${catalog.db.librarian.password}")
    private String librarianPassword;

    @Bean
    @Primary
    public DataSource dataSource() {
        Map<Object, Object> targets = new HashMap<>();
        targets.put("reader", pool("catalog-reader", url, readerUser, readerPassword));
        targets.put("reader02", pool("catalog-reader02", url, "db_catalog_reader02", reader02Password));
        targets.put("librarian", pool("catalog-librarian", url, librarianUser, librarianPassword));

        RoutingDataSource routing = new RoutingDataSource();
        routing.setTargetDataSources(targets);
        routing.setDefaultTargetDataSource(targets.get("reader"));
        routing.afterPropertiesSet();
        return routing;
    }

    @Bean
    public JdbcTemplate jdbcTemplate(DataSource dataSource) {
        // 注意：传入的是 RoutingDataSource，每次取连接时才决定用哪个账号
        return new JdbcTemplate(dataSource);
    }

    private HikariDataSource pool(String name, String jdbcUrl, String user, String password) {
        HikariConfig c = new HikariConfig();
        c.setJdbcUrl(jdbcUrl);
        c.setUsername(user);
        c.setPassword(password);
        c.setDriverClassName("org.opengauss.Driver");
        c.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'");
        c.setMaximumPoolSize(6);
        c.setMinimumIdle(0);
        c.setConnectionTimeout(5000);
        // 启动时不要因为某个账号连不上就整体失败，用到时才报错
        c.setInitializationFailTimeout(-1);
        c.setPoolName(name);
        return new HikariDataSource(c);
    }
}
