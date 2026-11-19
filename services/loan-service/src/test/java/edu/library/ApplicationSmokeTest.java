package edu.library;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP server and driver initialization; no database is simulated as healthy. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
 "LOAN_DB_READER01_PASSWORD=test-only",
 "LOAN_DB_READER02_PASSWORD=test-only",
 "LOAN_DB_LIBRARIAN01_PASSWORD=test-only"
})
class ApplicationSmokeTest {
 @Autowired TestRestTemplate http;
 @Test void applicationStartsAndServesPage(){
  var response=http.getForEntity("/",String.class);
  assertEquals(200,response.getStatusCode().value());
  assertTrue(response.getBody().contains("图书借还工作台"));
 }
 @Test void missingAuthenticationIsRejectedBeforeDatabaseAccess(){
  assertEquals(401,http.getForEntity("/api/loans",String.class).getStatusCode().value());
 }
 @Test void processHealthIsAvailable(){
  assertEquals(200,http.getForEntity("/api/health",String.class).getStatusCode().value());
 }
}
