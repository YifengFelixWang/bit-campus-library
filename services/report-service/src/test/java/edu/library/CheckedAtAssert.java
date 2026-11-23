package edu.library;

import java.time.Duration;
import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class CheckedAtAssert {
  private CheckedAtAssert() {}

  static void matches(String value) {
    assertTrue(value.matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}"), value);
    assertFalse(value.endsWith("Z"), value);
    LocalDateTime parsed = LocalDateTime.parse(value, ReportHealthController.CHECKED_AT);
    LocalDateTime now = LocalDateTime.now(ZoneId.of("Asia/Shanghai"));
    long skew = Math.abs(Duration.between(parsed, now).toSeconds());
    assertTrue(skew < 30, value);
  }
}
