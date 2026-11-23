package edu.library;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class DevServerRouteOrderTest {
  @Test
  void reportsRouteIsRegisteredBeforeGenericApi() throws Exception {
    String text = Files.readString(repoFile("deploy/dev-server.py"));
    int routesAt = text.indexOf("ROUTES = [");
    int end = text.indexOf("]", routesAt);
    assertTrue(routesAt >= 0 && end > routesAt);
    String block = text.substring(routesAt, end);
    int reports = block.indexOf("\"/api/reports/\"");
    int api = block.indexOf("\"/api/\"");
    assertTrue(reports >= 0 && api >= 0 && reports < api, block);
    String reportsEntry = block.substring(reports, block.indexOf(")", block.indexOf(")", reports) + 1));
    assertTrue(reportsEntry.contains("REPORT_SERVICE_URL"), reportsEntry);
    assertTrue(reportsEntry.contains("http://127.0.0.1:18084"), reportsEntry);
  }

  @Test
  void nginxReportsLocationPrecedesGenericApi() throws Exception {
    String nginx = Files.readString(repoFile("deploy/nginx.conf"));
    int reports = nginx.indexOf("location /api/reports/");
    int api = nginx.indexOf("location /api/ {");
    assertTrue(reports >= 0 && api >= 0 && reports < api);
    assertTrue(nginx.contains("report-service:18084"));
  }

  private static Path repoFile(String relative) {
    Path dir = Path.of("").toAbsolutePath();
    for (int i = 0; i < 6 && dir != null; i++) {
      Path candidate = dir.resolve(relative);
      if (Files.isRegularFile(candidate)) {
        return candidate;
      }
      dir = dir.getParent();
    }
    throw new IllegalStateException("Missing " + relative);
  }
}
