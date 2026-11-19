package edu.library;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import jakarta.annotation.PreDestroy;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.util.function.Function;

/** Separate pools: no SET ROLE or session identity leakage between requests. */
@Component
public class DatabaseSessions {
 private final Map<Long,HikariDataSource> pools=new HashMap<>();
 public DatabaseSessions(Environment env) {
  for(long id=1;id<=3;id++) {
   String name=id==3?"librarian01":"reader0"+id;
   HikariConfig c=new HikariConfig();
   c.setJdbcUrl(env.getProperty("LOAN_DB_URL","jdbc:opengauss://localhost:15432/library"));
   c.setUsername("db_loan_"+name);
   c.setPassword(env.getRequiredProperty("LOAN_DB_"+name.toUpperCase()+"_PASSWORD"));
   c.setDriverClassName("org.opengauss.Driver");
   c.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'");
   c.setMaximumPoolSize(8);c.setMinimumIdle(0);c.setConnectionTimeout(5000);
   c.setInitializationFailTimeout(-1);c.setPoolName("loan-"+name);
   pools.put(id,new HikariDataSource(c));
  }
 }
 public JdbcTemplate db(long userId){return new JdbcTemplate(pool(userId));}
 private HikariDataSource pool(long id){HikariDataSource p=pools.get(id);if(p==null)throw new IllegalArgumentException("Unknown mapped identity");return p;}
 public <T>T transaction(long id,Function<JdbcTemplate,T> action){
  HikariDataSource p=pool(id);TransactionTemplate tx=new TransactionTemplate(new DataSourceTransactionManager(p));
  tx.setTimeout(20);return tx.execute(status->action.apply(new JdbcTemplate(p)));
 }
 @PreDestroy public void close(){pools.values().forEach(HikariDataSource::close);}
}
