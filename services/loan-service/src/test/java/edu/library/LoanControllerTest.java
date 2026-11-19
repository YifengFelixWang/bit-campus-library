package edu.library;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import java.sql.Timestamp;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.server.ResponseStatusException;

class LoanControllerTest {
 private LoanController controller(DatabaseSessions db,LoanController.User user){
  return new LoanController(db,"http://127.0.0.1/unused"){
   @Override User verified(String token){return user;}
  };
 }
 @Test void rejectsIdentityAndRoleMismatch(){
  var db=mock(DatabaseSessions.class);
  var c=controller(db,new LoanController.User(1,List.of("LIBRARIAN"),"librarian01"));
  assertEquals(403,assertThrows(ResponseStatusException.class,()->c.user("test")).getStatusCode().value());
  verifyNoInteractions(db);
 }
 @Test void readerCannotBorrowForAnotherReader(){
  var db=mock(DatabaseSessions.class);var c=controller(db,new LoanController.User(1,List.of("READER"),"reader01"));
  assertThrows(ResponseStatusException.class,()->c.borrow("test",new LoanController.Borrow(2,2,14,"test-key-123")));
  verifyNoInteractions(db);
 }
 @Test void readerCannotQueryAllLoans(){
  var db=mock(DatabaseSessions.class);var c=controller(db,new LoanController.User(1,List.of("READER"),"reader01"));
  assertThrows(ResponseStatusException.class,()->c.loans("test",0,true));verifyNoInteractions(db);
 }
 @Test void readerCannotUseInternalSync(){
  var db=mock(DatabaseSessions.class);var c=controller(db,new LoanController.User(1,List.of("READER"),"reader01"));
  assertThrows(ResponseStatusException.class,()->c.changes("test","1970-01-01T00:00:00",0,10));verifyNoInteractions(db);
 }
 @Test void syncCursorPreservesMicrosecondsAndDeletedRows(){
  var db=mock(DatabaseSessions.class);var jdbc=mock(JdbcTemplate.class);when(db.db(3)).thenReturn(jdbc);
  var time=Timestamp.valueOf("2026-11-03 10:00:00.123456");
  Map<String,Object> row=Map.of("loan_id",9L,"updated_at",time,"deleted",true);
  when(jdbc.queryForList(anyString(),any(Object[].class))).thenReturn(List.of(row));
  var c=controller(db,new LoanController.User(0,List.of(),"sync-bot"));
  var response=(Map<?,?>)c.changes("test","1970-01-01T00:00:00",0,1);
  var cursor=(Map<?,?>)response.get("nextCursor");
  assertEquals("2026-11-03T10:00:00.123456",cursor.get("afterTime"));
  assertEquals(9L,cursor.get("afterId"));assertEquals(List.of(row),response.get("items"));
 }
 @Test void keyMatchesDColumnLength(){
  LoanController.key("a".repeat(64));
  assertThrows(ResponseStatusException.class,()->LoanController.key("a".repeat(65)));
  assertThrows(ResponseStatusException.class,()->LoanController.key(null));
 }
 @Test void generatedIdsAvoidSeedsAndJavascriptPrecisionLoss(){
  var ids=new HashSet<Long>();for(int i=0;i<10000;i++){long id=Ids.next();assertTrue(id>6&&id<(1L<<53));assertTrue(ids.add(id));}
 }
}
