package edu.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.http.ResponseEntity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 数据库端口不可达时，健康检查返回 DOWN，服务进程保持运行。 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "LIBRARY_JDBC_URL=jdbc:opengauss://127.0.0.1:1/library",
    "REPORT_DB_ANALYST_PASSWORD=not-the-real-password",
    "REPORT_DB_SYNC_PASSWORD=not-the-real-password"
})
class ReportHealthDownTest {
  @Autowired TestRestTemplate http;
  @Autowired ConfigurableApplicationContext application;
  @Autowired ReportDatabases databases;

  @Test
  void healthStaysUpWhenDatabaseIsDown() throws Exception {
    ResponseEntity<String> response = http.getForEntity("/api/reports/health", String.class);
    assertEquals(200, response.getStatusCode().value());
    JsonNode body = new ObjectMapper().readTree(response.getBody());
    assertEquals(3, body.size());
    assertEquals("report-service", body.get("service").asText());
    assertEquals("DOWN", body.get("database").asText());
    CheckedAtAssert.matches(body.get("checkedAt").asText());

    ResponseEntity<String> again = http.getForEntity("/api/reports/health", String.class);
    assertEquals(200, again.getStatusCode().value());
    assertTrue(application.isActive());
  }

  @Test
  void poolsUseSeparateReportAccounts() {
    assertEquals(ReportDatabases.ANALYST_USER, databases.analystPool().getUsername());
    assertEquals(ReportDatabases.SYNC_USER, databases.syncPool().getUsername());
    assertEquals("jdbc:opengauss://127.0.0.1:1/library", databases.analystPool().getJdbcUrl());
    assertEquals("jdbc:opengauss://127.0.0.1:1/library", databases.syncPool().getJdbcUrl());
    assertEquals("not-the-real-password", databases.analystPool().getPassword());
    assertEquals("not-the-real-password", databases.syncPool().getPassword());
    assertNotNull(databases.analyst());
    assertNotNull(databases.sync());
  }
}
