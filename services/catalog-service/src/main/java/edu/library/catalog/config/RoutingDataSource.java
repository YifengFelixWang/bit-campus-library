package edu.library.catalog.config;

import org.springframework.jdbc.datasource.lookup.AbstractRoutingDataSource;

/**
 * 按应用角色路由到不同数据库账号：
 *   READER    → db_catalog_reader01（只读）
 *   LIBRARIAN → db_catalog_librarian01（增改）
 *   ADMIN     → db_catalog_admin（增删改）
 * MyBatis 与 JdbcTemplate 共用这个 DataSource，因此读接口也会走到对应角色的账号上。
 */
public class RoutingDataSource extends AbstractRoutingDataSource {

    @Override
    protected Object determineCurrentLookupKey() {
        return RoleContext.dbKey();
    }
}
