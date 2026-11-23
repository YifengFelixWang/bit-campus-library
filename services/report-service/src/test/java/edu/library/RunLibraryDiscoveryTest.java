package edu.library;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class RunLibraryDiscoveryTest {
  @Test
  void launcherDiscoversReportProcess() throws Exception {
    Path dir = Path.of("").toAbsolutePath();
    Path script = null;
    for (int i = 0; i < 6 && dir != null; i++) {
      Path candidate = dir.resolve("scripts/run_library.py");
      if (Files.isRegularFile(candidate)) {
        script = candidate;
        break;
      }
      dir = dir.getParent();
    }
    assertTrue(script != null, "scripts/run_library.py not found");
    String text = Files.readString(script);
    String header = text.lines().findFirst().orElse("");
    assertTrue(header.contains("report"), header);
    assertTrue(text.contains("\"report\": \"report-service-1.0.0.jar\""));
    assertTrue(text.contains("\"report\": 18084"));
    assertTrue(text.contains("\"report\": \"/api/reports/health\""));
    assertTrue(text.contains("\"REPORT_DB_ANALYST\""));
    assertTrue(text.contains("\"REPORT_DB_SYNC\""));
    assertTrue(text.contains("REPORT_SERVICE_URL=urls[\"report\"]"));
  }
}
