package edu.library;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.http.HttpHeaders;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReportExportTest {

    private static final String ANALYST_TOKEN = "Bearer analyst-token";
    private static final String READER_TOKEN = "Bearer reader-token";
    private static final String LIBRARIAN_TOKEN = "Bearer librarian-token";

    private static final String CSV_HEADER_LINE = "categoryName,title,readerName,borrowedAt,status";

    private ObjectMapper objectMapper;
    private ReportDatabases databases;
    private JdbcTemplate analystTemplate;
    private ReportQueryService reportQueryService;
    private ReportStatsService reportStatsService;
    private ReportExportService reportExportService;
    private ReportStatsExportController controller;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        databases = mock(ReportDatabases.class);
        analystTemplate = mock(JdbcTemplate.class);
        when(databases.analyst()).thenReturn(analystTemplate);

        IdentityGate.IdentityHttpClient identityHttp = (url, authorization) -> {
            if (ANALYST_TOKEN.equals(authorization)) {
                return new IdentityGate.IdentityHttpResponse(200,
                        "{\"id\":1,\"username\":\"analyst\",\"roles\":[\"ANALYST\"]}");
            }
            if (READER_TOKEN.equals(authorization)) {
                return new IdentityGate.IdentityHttpResponse(200,
                        "{\"id\":2,\"username\":\"reader\",\"roles\":[\"READER\"]}");
            }
            if (LIBRARIAN_TOKEN.equals(authorization)) {
                return new IdentityGate.IdentityHttpResponse(200,
                        "{\"id\":3,\"username\":\"librarian\",\"roles\":[\"LIBRARIAN\"]}");
            }
            return new IdentityGate.IdentityHttpResponse(401, "{}");
        };

        IdentityGate identityGate = new IdentityGate("http://test/users/me", identityHttp, objectMapper);
        reportQueryService = new ReportQueryService(databases);
        reportStatsService = new ReportStatsService(databases);
        reportExportService = new ReportExportService(reportQueryService, objectMapper);
        controller = new ReportStatsExportController(identityGate, reportStatsService, reportExportService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void e1_analyst_noFilter_csvRowCountMatchesQuery() throws Exception {
        List<Map<String, Object>> dbRows = List.of(
                row("文学", "书A", "读者1", "2024-01-01T10:00:00", "BORROWED"),
                row("科技", "书B", "读者2", "2024-02-01T11:00:00", "RETURNED")
        );
        when(analystTemplate.queryForList(anyString(), any(Object[].class))).thenReturn(dbRows);

        ObjectNode body = objectMapper.createObjectNode();
        int queryRowCount = reportQueryService.query(body).rows().size();

        MvcResult result = mockMvc.perform(get("/api/reports/export")
                        .header("Authorization", ANALYST_TOKEN))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv;charset=UTF-8"))
                .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                        containsString("attachment; filename=\"report.csv\"")))
                .andReturn();

        byte[] bytes = result.getResponse().getContentAsByteArray();
        assertTrue(hasUtf8Bom(bytes));
        String csv = new String(stripBom(bytes), StandardCharsets.UTF_8);
        String[] lines = csv.split("\n", -1);
        assertEquals(CSV_HEADER_LINE, lines[0].replace("\r", ""));
        int dataLines = lines.length - 1;
        if (lines.length > 1 && lines[lines.length - 1].isEmpty()) {
            dataLines--;
        }
        assertEquals(queryRowCount, dataLines);
    }

    @Test
    void e2_analyst_statusReturned_csvMatchesQueryRows() throws Exception {
        List<Map<String, Object>> dbRows = List.of(
                row("文学", "书A", "读者1", "2024-01-01T10:00:00", "RETURNED"),
                row("文学", "书C", "读者3", "2024-03-01T09:00:00", "RETURNED")
        );
        when(analystTemplate.queryForList(anyString(), any(Object[].class))).thenReturn(dbRows);

        ObjectNode body = objectMapper.createObjectNode();
        body.put("status", "RETURNED");
        List<Map<String, Object>> queryRows = reportQueryService.query(body).rows();

        MvcResult result = mockMvc.perform(get("/api/reports/export")
                        .header("Authorization", ANALYST_TOKEN)
                        .param("status", "RETURNED"))
                .andExpect(status().isOk())
                .andReturn();

        String csv = new String(stripBom(result.getResponse().getContentAsByteArray()), StandardCharsets.UTF_8);
        List<String> dataLines = csvDataLines(csv);
        assertEquals(queryRows.size(), dataLines.size());
        for (int i = 0; i < queryRows.size(); i++) {
            assertEquals(expectedCsvLine(queryRows.get(i)), dataLines.get(i));
        }
    }

    @Test
    void e2b_analyst_categoryIdQueryParam_isAccepted() throws Exception {
        when(analystTemplate.queryForList(anyString(), any(Object[].class))).thenReturn(List.of(
                row("文学", "围城", "读者二", "2024-01-01T10:00:00", "BORROWED")
        ));

        MvcResult result = mockMvc.perform(get("/api/reports/export")
                        .header("Authorization", ANALYST_TOKEN)
                        .param("categoryId", "1")
                        .param("status", "BORROWED")
                        .param("sortOrder", "desc"))
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith("text/csv;charset=UTF-8"))
                .andReturn();

        String csv = new String(stripBom(result.getResponse().getContentAsByteArray()), StandardCharsets.UTF_8);
        assertEquals(1, csvDataLines(csv).size());
        assertTrue(csv.contains("围城"));
    }

    @Test
    void e3_librarianAndReader_forbidden() throws Exception {
        mockMvc.perform(get("/api/reports/export")
                        .header("Authorization", LIBRARIAN_TOKEN))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/reports/export")
                        .header("Authorization", READER_TOKEN))
                .andExpect(status().isForbidden());

        mockMvc.perform(get("/api/reports/stats")
                        .header("Authorization", READER_TOKEN))
                .andExpect(status().isForbidden());
    }

    @Test
    void e4_sortByPassword_badRequestNotCsv() throws Exception {
        mockMvc.perform(get("/api/reports/export")
                        .header("Authorization", ANALYST_TOKEN)
                        .param("sortBy", "password"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FIELD"))
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON));

        verify(analystTemplate, never()).queryForList(anyString(), any(Object[].class));
    }

    @Test
    void s1_analyst_stats_loanAndOpenCounts() throws Exception {
        Map<String, Object> cat1 = new LinkedHashMap<>();
        cat1.put("category_id", 1L);
        cat1.put("category_name", "文学");
        cat1.put("loan_count", 5L);
        cat1.put("open_count", 2L);
        Map<String, Object> cat2 = new LinkedHashMap<>();
        cat2.put("category_id", 2L);
        cat2.put("category_name", "科技");
        cat2.put("loan_count", 3L);
        cat2.put("open_count", 3L);
        when(analystTemplate.queryForList(anyString(), any(Object[].class)))
                .thenReturn(List.of(cat1, cat2));

        mockMvc.perform(get("/api/reports/stats")
                        .header("Authorization", ANALYST_TOKEN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.categories[0].loanCount").value(5))
                .andExpect(jsonPath("$.categories[0].openCount").value(2))
                .andExpect(jsonPath("$.categories[1].loanCount").value(3))
                .andExpect(jsonPath("$.categories[1].openCount").value(3));
    }

  private static Map<String, Object> row(
          String categoryName, String title, String reader, String borrowedAt, String status) {
    Map<String, Object> m = new LinkedHashMap<>();
    m.put("category_name", categoryName);
    m.put("title", title);
    m.put("display_name", reader);
    m.put("borrowed_at", java.sql.Timestamp.valueOf(borrowedAt.replace('T', ' ')));
    m.put("status", status);
    return m;
  }

  private static String expectedCsvLine(Map<String, Object> row) {
    return ReportExportService.escapeCsv(string(row.get("categoryName"))) + ','
        + ReportExportService.escapeCsv(string(row.get("title"))) + ','
        + ReportExportService.escapeCsv(string(row.get("readerName"))) + ','
        + ReportExportService.escapeCsv(string(row.get("borrowedAt"))) + ','
        + ReportExportService.escapeCsv(string(row.get("status")));
  }

  private static String string(Object v) {
    return v == null ? "" : String.valueOf(v);
  }

  private static List<String> csvDataLines(String csv) {
    String[] lines = csv.split("\n");
    List<String> data = new ArrayList<>();
    for (int i = 1; i < lines.length; i++) {
      String line = lines[i].replace("\r", "");
      if (line.isEmpty() && i == lines.length - 1) {
        continue;
      }
      data.add(line);
    }
    return data;
  }

  private static boolean hasUtf8Bom(byte[] bytes) {
    return bytes.length >= 3
        && (bytes[0] & 0xFF) == 0xEF
        && (bytes[1] & 0xFF) == 0xBB
        && (bytes[2] & 0xFF) == 0xBF;
  }

  private static byte[] stripBom(byte[] bytes) {
    if (hasUtf8Bom(bytes)) {
      byte[] stripped = new byte[bytes.length - 3];
      System.arraycopy(bytes, 3, stripped, 0, stripped.length);
      return stripped;
    }
    return bytes;
  }

}