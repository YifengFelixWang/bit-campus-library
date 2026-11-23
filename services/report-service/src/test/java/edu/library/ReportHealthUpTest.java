package edu.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;

/**
 * 启动真实 HTTP 服务。分析员 JdbcTemplate 由 Mockito 代替：
 * SELECT 1 返回 1，从而覆盖数据库可用时的 UP 分支。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "LIBRARY_JDBC_URL=jdbc:opengauss://127.0.0.1:1/library",
    "REPORT_DB_ANALYST_PASSWORD=test-only",
    "REPORT_DB_SYNC_PASSWORD=test-only"
})
class ReportHealthUpTest {
  @Autowired TestRestTemplate http;

  @MockitoBean ReportDatabases databases;

  @MockitoBean LoanSyncService loanSyncService;

  @BeforeEach
  void analystAcceptsSelectOne() {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    doReturn(1).when(jdbc).queryForObject("SELECT 1", Object.class);
    doReturn(jdbc).when(databases).analyst();
  }

  @Test
  void healthReportsUpWhenSelectOneSucceeds() throws Exception {
    ResponseEntity<String> response = http.getForEntity("/api/reports/health", String.class);
    assertEquals(200, response.getStatusCode().value());
    assertTrue(response.getHeaders().getContentType().toString().contains("application/json"));
    JsonNode body = new ObjectMapper().readTree(response.getBody());
    assertEquals(3, body.size());
    assertEquals("report-service", body.get("service").asText());
    assertEquals("UP", body.get("database").asText());
    CheckedAtAssert.matches(body.get("checkedAt").asText());
  }
}
