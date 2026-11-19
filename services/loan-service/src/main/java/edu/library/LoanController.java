package edu.library;

import java.util.*;
import java.time.*;
import java.sql.Timestamp;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class LoanController {
 private final DatabaseSessions sessions;
 private final RestClient identity;
 private final String identityUrl;
 public LoanController(DatabaseSessions sessions,@Value("${identity.url}") String url){
  this.sessions=sessions;this.identityUrl=url;
  SimpleClientHttpRequestFactory f=new SimpleClientHttpRequestFactory();
  f.setConnectTimeout(Duration.ofSeconds(3));f.setReadTimeout(Duration.ofSeconds(5));
  this.identity=RestClient.builder().requestFactory(f).build();
 }
 public record User(long id,List<String> roles,String username) {}
 public record Borrow(long readerId,long copyId,int days,String requestKey) {}
 public record Return(String requestKey) {}
 public record Copy(long bookId,String barcode) {}
 public record Snapshot(long bookId,String title,String isbn) {}
 public record Borrower(long userId,int maxLoanCount,boolean active) {}
 User verified(String token){
  if(token==null||!token.startsWith("Bearer "))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
  try {
   User u=identity.get().uri(identityUrl).header("Authorization",token).retrieve().body(User.class);
   if(u==null||u.roles()==null||u.username()==null)throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
   return u;
  } catch(RestClientResponseException e){throw new ResponseStatusException(e.getStatusCode().is4xxClientError()?HttpStatus.UNAUTHORIZED:HttpStatus.SERVICE_UNAVAILABLE);}
  catch(ResourceAccessException e){throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"身份服务暂不可用");}
 }
 User user(String token){
  User u=verified(token);
  String expected=u.id()==1?"reader01":u.id()==2?"reader02":u.id()==3?"librarian01":"";
  if(u.id()<1||u.id()>3||!expected.equals(u.username())||!u.roles().contains(u.id()==3?"LIBRARIAN":"READER"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  return u;
 }
 void staff(User u){if(u.id()!=3||!u.roles().contains("LIBRARIAN"))throw new ResponseStatusException(HttpStatus.FORBIDDEN);}
 static void key(String k){if(k==null||!k.matches("[A-Za-z0-9_-]{8,64}"))throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"请求号应为 8–64 位字母数字或横线");}
 static void valid(boolean condition){if(!condition)throw new ResponseStatusException(HttpStatus.BAD_REQUEST);}
 @GetMapping("/health") Object health(){return Map.of("status","UP");}
 @GetMapping("/me") Object me(@RequestHeader(value="Authorization",required=false) String token){
  User u=user(token);return Map.of("id",u.id(),"roles",u.roles(),"username",u.username(),"database",sessions.db(u.id()).queryForMap("select current_user as current_user,session_user as session_user"));
 }
 @GetMapping("/copies") Object copies(@RequestHeader(value="Authorization",required=false) String token,@RequestParam(defaultValue="0") long after){
  User u=user(token);return sessions.db(u.id()).queryForList("select c.*,b.title from loan.book_copy c left join loan.book_snapshot b on b.book_id=c.book_id where c.copy_id>? order by c.copy_id limit 100",after);
 }
 @PostMapping("/copies") Object copy(@RequestHeader(value="Authorization",required=false) String token,@RequestBody Copy c){
  User u=user(token);staff(u);valid(c.bookId()>0&&c.barcode()!=null&&!c.barcode().isBlank()&&c.barcode().length()<=64);
  JdbcTemplate db=sessions.db(u.id());
  valid(db.queryForObject("select count(*) from loan.book_snapshot where book_id=?",Integer.class,c.bookId())==1);
  return db.queryForMap("insert into loan.book_copy(copy_id,book_id,barcode,status,updated_at) values(?,?,?,'AVAILABLE',clock_timestamp()) returning *",Ids.next(),c.bookId(),c.barcode());
 }
 public record BatchCopy(long bookId,String title,String isbn,int count) {}
 /**
  * 批量补登副本：把某本书的副本数补齐到 count（已有册数不退不删），
  * 一次事务内完成 snapshot upsert + 若干 insert，条码形如 B{bookId}-{序号}。
  * 导入 CSV 带 copies 列时前端只调一次，不必按册发 N 个请求。
  */
 @PostMapping("/copies/batch") Object copiesBatch(@RequestHeader(value="Authorization",required=false) String token,@RequestBody BatchCopy b){
  User u=user(token);staff(u);
  valid(b.bookId()>0&&b.count()>=0&&b.count()<=50);
  valid(b.title()!=null&&!b.title().isBlank()&&b.title().length()<=200&&b.isbn()!=null&&b.isbn().length()<=32);
  return sessions.transaction(u.id(),db->{
   db.execute("lock table loan.book_snapshot in exclusive mode");
   if(db.update("update loan.book_snapshot set title=?,isbn=?,updated_at=clock_timestamp() where book_id=?",b.title(),b.isbn(),b.bookId())==0)
    db.update("insert into loan.book_snapshot values(?,?,?,clock_timestamp())",b.bookId(),b.title(),b.isbn());

   db.execute("lock table loan.book_copy in exclusive mode");
   List<String> codes=db.queryForList("select barcode from loan.book_copy where book_id=?",String.class,b.bookId());
   int have=codes.size();
   int next=0;   // 该书上已有条码的最大序号，新条码从这里往后排
   for(String code:codes){
    int dash=code.lastIndexOf('-');
    if(dash<0||dash==code.length()-1)continue;
    try{next=Math.max(next,Integer.parseInt(code.substring(dash+1)));}catch(NumberFormatException ignored){}
   }
   int created=0;
   for(int i=have;i<b.count();i++){
    String barcode="B"+b.bookId()+"-"+(++next);
    // 条码全局唯一：撞上别的书的条码就跳号重试
    while(db.queryForObject("select count(*) from loan.book_copy where barcode=?",Integer.class,barcode)>0)
     barcode="B"+b.bookId()+"-"+(++next);
    db.update("insert into loan.book_copy(copy_id,book_id,barcode,status,updated_at) values(?,?,?,'AVAILABLE',clock_timestamp())",Ids.next(),b.bookId(),barcode);
    created+=1;
   }
   Map<String,Object> out=new LinkedHashMap<>();
   out.put("bookId",b.bookId());out.put("before",have);out.put("created",created);out.put("total",have+created);
   return out;
  });
 }
 @PutMapping("/book-snapshots") Object snapshot(@RequestHeader(value="Authorization",required=false) String token,@RequestBody Snapshot b){
  User u=user(token);staff(u);valid(b.bookId()>0&&b.title()!=null&&!b.title().isBlank()&&b.title().length()<=200&&b.isbn()!=null&&b.isbn().length()<=32);
  return sessions.transaction(u.id(),db->{
   db.execute("lock table loan.book_snapshot in exclusive mode");
   if(db.update("update loan.book_snapshot set title=?,isbn=?,updated_at=clock_timestamp() where book_id=?",b.title(),b.isbn(),b.bookId())==0)
    db.update("insert into loan.book_snapshot values(?,?,?,clock_timestamp())",b.bookId(),b.title(),b.isbn());
   return Map.of("book_id",b.bookId());
  });
 }
 @PutMapping("/borrowers") Object borrower(@RequestHeader(value="Authorization",required=false) String token,@RequestBody Borrower b){
  User u=user(token);staff(u);valid(b.userId()>0&&b.maxLoanCount()>=1&&b.maxLoanCount()<=100);
  return sessions.transaction(u.id(),db->{
   db.execute("lock table loan.borrower_account in exclusive mode");
   if(db.update("update loan.borrower_account set max_loan_count=?,active=?,updated_at=clock_timestamp() where user_id=?",b.maxLoanCount(),b.active(),b.userId())==0)
    db.update("insert into loan.borrower_account values(?,?,?,clock_timestamp())",b.userId(),b.maxLoanCount(),b.active());
   return Map.of("user_id",b.userId());
  });
 }
 @GetMapping("/loans") Object loans(@RequestHeader(value="Authorization",required=false) String token,@RequestParam(defaultValue="0") long after,@RequestParam(defaultValue="false") boolean all){
  User u=user(token);if(all)staff(u);
  return sessions.db(u.id()).queryForList("select l.*,b.title,c.barcode,(l.status='BORROWED' and l.due_at<localtimestamp) as overdue from loan.loan_record l join loan.book_copy c on c.copy_id=l.copy_id join loan.book_snapshot b on b.book_id=l.book_id where l.loan_id>? and not l.deleted"+(all?"":" and l.user_id=?")+" order by l.loan_id limit 100",all?new Object[]{after}:new Object[]{after,u.id()});
 }
 @GetMapping("/borrow-counts") Object borrowCounts(){
  return sessions.db(1).queryForList("select book_id,count(*) as borrows from loan.loan_record where not deleted group by book_id order by book_id");
 }
 @PostMapping("/loans") Object borrow(@RequestHeader(value="Authorization",required=false) String token,@RequestBody Borrow b){
  User u=user(token);key(b.requestKey());if(b.readerId()!=u.id())staff(u);valid(b.copyId()>0&&b.readerId()>0&&b.days()>=1&&b.days()<=30);
  return sessions.transaction(u.id(),db->{
   db.query("call loan.sp_borrow_copy(?,?,?,?,?)",rs->null,b.readerId(),b.copyId(),b.days(),b.requestKey(),Ids.next());
   return result(db,u.id(),b.requestKey());
  });
 }
 @PostMapping("/loans/{id}/return") Object giveBack(@RequestHeader(value="Authorization",required=false) String token,@PathVariable long id,@RequestBody Return r){
  User u=user(token);key(r.requestKey());valid(id>0);
  return sessions.transaction(u.id(),db->{
   db.query("call loan.sp_return_copy(?,?)",rs->null,id,r.requestKey());
   return result(db,u.id(),r.requestKey());
  });
 }
 Object result(JdbcTemplate db,long actor,String key){return db.queryForMap("select l.* from loan.loan_record l join loan.request_dedup d on d.loan_id=l.loan_id where d.user_id=? and d.request_no=?",actor,key);}
 @GetMapping("/internal/loans/changes") Object changes(@RequestHeader(value="Authorization",required=false) String token,
   @RequestParam(defaultValue="1970-01-01T00:00:00") String afterTime,@RequestParam(defaultValue="0") long afterId,@RequestParam(defaultValue="100") int limit){
  User u=verified(token);if(!"sync-bot".equals(u.username()))throw new ResponseStatusException(HttpStatus.FORBIDDEN);
  valid(limit>=1&&limit<=500&&afterId>=0);
  LocalDateTime t;try{t=LocalDateTime.parse(afterTime);}catch(Exception e){throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"时间格式无效");}
  // Dedicated internal request; source reading uses C's own schema account, not db_report_sync.
  var rows=sessions.db(3).queryForList("select * from loan.loan_record where updated_at>? or (updated_at=? and loan_id>?) order by updated_at,loan_id limit ?",Timestamp.valueOf(t),Timestamp.valueOf(t),afterId,limit);
  Map<String,Object> cursor=new LinkedHashMap<>();cursor.put("afterTime",afterTime);cursor.put("afterId",afterId);
  if(!rows.isEmpty()){var last=rows.get(rows.size()-1);cursor.put("afterTime",((Timestamp)last.get("updated_at")).toLocalDateTime().toString());cursor.put("afterId",last.get("loan_id"));}
  return Map.of("items",rows,"nextCursor",cursor,"hasMore",rows.size()==limit);
 }
 @ExceptionHandler(DataAccessException.class) ResponseEntity<?> databaseError(DataAccessException e){
  String message=Objects.toString(e.getMostSpecificCause().getMessage(),"");
  for(String code:List.of("FORBIDDEN","INVALID_ARGUMENT","READER_NOT_FOUND","READER_DISABLED","IDEMPOTENCY_CONFLICT","LOAN_LIMIT","COPY_NOT_FOUND","COPY_UNAVAILABLE","LOAN_NOT_FOUND","BOOK_SNAPSHOT_MISSING")){
   if(message.contains(code))return ResponseEntity.status(code.equals("FORBIDDEN")?403:409).body(Map.of("code",code));
  }
  if(e instanceof org.springframework.dao.DuplicateKeyException)return ResponseEntity.status(409).body(Map.of("code","DUPLICATE_KEY"));
  return ResponseEntity.status(503).body(Map.of("code","DATABASE_ERROR","message","数据库不可用或约束冲突，请保留原请求号重试"));
 }
}

