package edu.library;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@Service
public class ReportExportService {

    private static final byte[] UTF8_BOM = new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    private static final String CSV_HEADER = "categoryName,title,readerName,borrowedAt,status";
    private static final String[] CSV_FIELDS = {
            "categoryName", "title", "readerName", "borrowedAt", "status"
    };

    private final ReportQueryService reportQueryService;
    private final ObjectMapper objectMapper;

    public ReportExportService(ReportQueryService reportQueryService, ObjectMapper objectMapper) {
        this.reportQueryService = reportQueryService;
        this.objectMapper = objectMapper;
    }

    public byte[] exportCsv(
            String categoryId,
            String bookId,
            String status,
            String from,
            String to,
            String sortBy,
            String sortOrder
    ) {
        ObjectNode body = objectMapper.createObjectNode();
        putIfPresent(body, "categoryId", categoryId);
        putIfPresent(body, "bookId", bookId);
        putIfPresent(body, "status", status);
        putIfPresent(body, "from", from);
        putIfPresent(body, "to", to);
        putIfPresent(body, "sortBy", sortBy);
        putIfPresent(body, "sortOrder", sortOrder);

        ReportQueryService.ReportQueryResult result = reportQueryService.query(body);
        return buildCsv(result.rows());
    }

    private static void putIfPresent(ObjectNode body, String key, String value) {
        if (value == null || value.isBlank()) {
            return;
        }
        if ("categoryId".equals(key) || "bookId".equals(key)) {
            try {
                body.put(key, Long.parseLong(value.trim()));
            } catch (NumberFormatException ex) {
                body.put(key, value);
            }
            return;
        }
        body.put(key, value);
    }

    private static byte[] buildCsv(List<Map<String, Object>> rows) {
        StringBuilder sb = new StringBuilder();
        sb.append(CSV_HEADER).append('\n');
        for (Map<String, Object> row : rows) {
            for (int i = 0; i < CSV_FIELDS.length; i++) {
                if (i > 0) {
                    sb.append(',');
                }
                sb.append(escapeCsv(stringValue(row.get(CSV_FIELDS[i]))));
            }
            sb.append('\n');
        }
        byte[] content = sb.toString().getBytes(StandardCharsets.UTF_8);
        byte[] withBom = new byte[UTF8_BOM.length + content.length];
        System.arraycopy(UTF8_BOM, 0, withBom, 0, UTF8_BOM.length);
        System.arraycopy(content, 0, withBom, UTF8_BOM.length, content.length);
        return withBom;
    }

    static String escapeCsv(String value) {
        if (value == null) {
            return "";
        }
        boolean needsQuotes = value.indexOf(',') >= 0
                || value.indexOf('"') >= 0
                || value.indexOf('\n') >= 0
                || value.indexOf('\r') >= 0;
        if (!needsQuotes) {
            return value;
        }
        return '"' + value.replace("\"", "\"\"") + '"';
    }

    private static String stringValue(Object v) {
        return v == null ? "" : String.valueOf(v);
    }
}