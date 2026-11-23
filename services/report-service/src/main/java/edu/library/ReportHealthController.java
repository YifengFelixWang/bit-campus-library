package edu.library;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 不要求登录。库不可用时 HTTP 仍为 200，由 database 字段表示状态。 */
@RestController
public class ReportHealthController {
  static final DateTimeFormatter CHECKED_AT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS");
  static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");

  private final ReportDatabases databases;

  public ReportHealthController(ReportDatabases databases) {
    this.databases = databases;
  }

  @GetMapping("/api/reports/health")
  public ResponseEntity<Map<String, String>> health() {
    Map<String, String> body = new LinkedHashMap<>();
    body.put("service", "report-service");
    body.put("database", probe());
    body.put("checkedAt", LocalDateTime.now(SHANGHAI).format(CHECKED_AT));
    return ResponseEntity.ok(body);
  }

  private String probe() {
    try {
      Object result = databases.analyst().queryForObject("SELECT 1", Object.class);
      return result != null ? "UP" : "DOWN";
    } catch (Exception ex) {
      return "DOWN";
    }
  }
}
