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

/**
 * Separate pools: no SET ROLE or session identity leakage between requests.
 *
 * 演示账号（1–3）各有独立库角色，一个账号一个连接池。
 * 自助注册的读者人数不固定，不可能一人建一个库角色，因此共用 db_loan_selfreader，
 * 由事务内的 library.reader_id 告诉数据库"这次操作的是谁"，actor_id() 负责取用。
 */
@Component
public class DatabaseSessions {
 private final Map<Long,HikariDataSource> pools=new HashMap<>();
 private final HikariDataSource selfReader;
 public DatabaseSessions(Environment env) {
  for(long id=1;id<=3;id++) {
   String name=id==3?"librarian01":"reader0"+id;
   HikariConfig c=poolConfig(env,"db_loan_"+name,
     env.getRequiredProperty("LOAN_DB_"+name.toUpperCase()+"_PASSWORD"),"loan-"+name);
   pools.put(id,new HikariDataSource(c));
  }
  selfReader=new HikariDataSource(poolConfig(env,
    env.getProperty("LOAN_DB_SELFREADER_USERNAME","db_loan_selfreader"),
    env.getRequiredProperty("LOAN_DB_SELFREADER_PASSWORD"),"loan-selfreader"));
 }
 private static HikariConfig poolConfig(Environment env,String username,String password,String poolName){
  HikariConfig c=new HikariConfig();
  c.setJdbcUrl(env.getProperty("LOAN_DB_URL","jdbc:opengauss://localhost:15432/library"));
  c.setUsername(username);
  c.setPassword(password);
  c.setDriverClassName("org.opengauss.Driver");
  c.setConnectionInitSql("SET TIME ZONE 'Asia/Shanghai'");
  c.setMaximumPoolSize(8);c.setMinimumIdle(0);c.setConnectionTimeout(5000);
  c.setInitializationFailTimeout(-1);c.setPoolName(poolName);
  return c;
 }
 public JdbcTemplate db(long userId){return new JdbcTemplate(pool(userId));}
 private HikariDataSource pool(long id){
  if(id>=1&&id<=3){HikariDataSource p=pools.get(id);if(p!=null)return p;}
  return selfReader;
 }
 public <T>T transaction(long id,Function<JdbcTemplate,T> action){
  HikariDataSource p=pool(id);TransactionTemplate tx=new TransactionTemplate(new DataSourceTransactionManager(p));
  tx.setTimeout(20);
  return tx.execute(status->{
   JdbcTemplate db=new JdbcTemplate(p);
   // 只在事务内声明"操作人"，连接归还池后 GUC 随事务结束失效，不会串到下一个请求
   if(id>3)db.queryForObject("select set_config('library.reader_id', ?, true)",String.class,String.valueOf(id));
   return action.apply(db);
  });
 }
 @PreDestroy public void close(){pools.values().forEach(HikariDataSource::close);selfReader.close();}
}
