package edu.library;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoField;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class ReportQueryService {

    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");

    private static final String SQL_BASE = """
            SELECT c.category_name, b.title, r.display_name, lf.borrowed_at, lf.status
            FROM report.loan_fact lf
            JOIN report.book_dim b ON b.book_id = lf.book_id AND b.deleted = FALSE
            JOIN report.category_dim c ON c.category_id = b.category_id AND c.deleted = FALSE
            JOIN report.reader_dim r ON r.user_id = lf.user_id AND r.deleted = FALSE
            WHERE lf.deleted = FALSE""";

    private static final Map<String, String> SORT_COLUMNS = Map.of(
            "categoryName", "c.category_name",
            "title", "b.title",
            "readerName", "r.display_name",
            "borrowedAt", "lf.borrowed_at",
            "status", "lf.status"
    );

    private static final Set<String> KNOWN_FIELDS = Set.of(
            "categoryId", "bookId", "status", "from", "to", "sortBy", "sortOrder"
    );

    private static final DateTimeFormatter DATE_TIME_PARSER = new DateTimeFormatterBuilder()
            .parseCaseInsensitive()
            .append(DateTimeFormatter.ISO_LOCAL_DATE)
            .appendLiteral('T')
            .appendValue(ChronoField.HOUR_OF_DAY, 2)
            .appendLiteral(':')
            .appendValue(ChronoField.MINUTE_OF_HOUR, 2)
            .appendLiteral(':')
            .appendValue(ChronoField.SECOND_OF_MINUTE, 2)
            .optionalStart()
            .appendFraction(ChronoField.NANO_OF_SECOND, 1, 6, true)
            .optionalEnd()
            .toFormatter(Locale.ROOT);

    private static final DateTimeFormatter OUTPUT_WITH_FRACTION = new DateTimeFormatterBuilder()
            .appendPattern("yyyy-MM-dd'T'HH:mm:ss")
            .appendFraction(ChronoField.NANO_OF_SECOND, 0, 6, true)
            .toFormatter(Locale.ROOT);

    private static final DateTimeFormatter OUTPUT_NO_FRACTION =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT);

    private final ReportDatabases databases;

    public ReportQueryService(ReportDatabases databases) {
        this.databases = databases;
    }

    public ReportQueryResult query(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new InvalidFieldException();
        }

        Long categoryId = null;
        Long bookId = null;
        String status = null;
        LocalDateTime from = null;
        LocalDateTime to = null;
        String sortBy = "borrowedAt";
        String sortOrder = "desc";

        var fields = body.fields();
        while (fields.hasNext()) {
            var entry = fields.next();
            String name = entry.getKey();
            JsonNode value = entry.getValue();

            if (!KNOWN_FIELDS.contains(name)) {
                continue;
            }

            switch (name) {
                case "categoryId" -> categoryId = parsePositiveLong(name, value);
                case "bookId" -> bookId = parsePositiveLong(name, value);
                case "status" -> status = parseStatus(value);
                case "from" -> from = parseDateTime(value);
                case "to" -> to = parseDateTime(value);
                case "sortBy" -> sortBy = parseSortBy(value);
                case "sortOrder" -> sortOrder = parseSortOrder(value);
                default -> {
                }
            }
        }

        StringBuilder sql = new StringBuilder(SQL_BASE);
        List<Object> parameters = new ArrayList<>();

        if (categoryId != null) {
            sql.append("\nAND c.category_id = ?");
            parameters.add(categoryId);
        }
        if (bookId != null) {
            sql.append("\nAND lf.book_id = ?");
            parameters.add(bookId);
        }
        if (status != null) {
            sql.append("\nAND lf.status = ?");
            parameters.add(status);
        }
        if (from != null) {
            sql.append("\nAND lf.borrowed_at >= ?");
            parameters.add(Timestamp.valueOf(from));
        }
        if (to != null) {
            sql.append("\nAND lf.borrowed_at <= ?");
            parameters.add(Timestamp.valueOf(to));
        }

        String orderColumn = SORT_COLUMNS.get(sortBy);
        String orderDir = "asc".equals(sortOrder) ? "ASC" : "DESC";
        sql.append("\nORDER BY ").append(orderColumn).append(' ').append(orderDir);

        String sqlTemplate = sql.toString();
        JdbcTemplate analyst = databases.analyst();
        List<Map<String, Object>> rawRows = analyst.queryForList(sqlTemplate, parameters.toArray());

        List<Map<String, Object>> rows = new ArrayList<>(rawRows.size());
        for (Map<String, Object> raw : rawRows) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("categoryName", stringValue(raw.get("category_name")));
            row.put("title", stringValue(raw.get("title")));
            row.put("readerName", stringValue(raw.get("display_name")));
            row.put("borrowedAt", formatBorrowedAt(raw.get("borrowed_at")));
            row.put("status", stringValue(raw.get("status")));
            rows.add(row);
        }

        return new ReportQueryResult(rows, sqlTemplate, List.copyOf(parameters));
    }

    private static Long parsePositiveLong(String field, JsonNode value) {
        if (isOmitted(value)) {
            return null;
        }
        if (!value.canConvertToLong()) {
            throw new InvalidFieldException();
        }
        long n = value.asLong();
        if (n <= 0) {
            throw new InvalidFieldException();
        }
        return n;
    }

    private static String parseStatus(JsonNode value) {
        if (isOmitted(value)) {
            return null;
        }
        if (!value.isTextual()) {
            throw new InvalidFieldException();
        }
        String s = value.asText();
        if ("BORROWED".equals(s) || "RETURNED".equals(s)) {
            return s;
        }
        throw new InvalidFieldException();
    }

    private static LocalDateTime parseDateTime(JsonNode value) {
        if (isOmitted(value)) {
            return null;
        }
        if (!value.isTextual()) {
            throw new InvalidFieldException();
        }
        String s = value.asText();
        try {
            return LocalDateTime.parse(s, DATE_TIME_PARSER);
        } catch (DateTimeParseException e) {
            throw new InvalidFieldException();
        }
    }

    private static String parseSortBy(JsonNode value) {
        if (isOmitted(value)) {
            return "borrowedAt";
        }
        if (!value.isTextual()) {
            throw new InvalidFieldException();
        }
        String s = value.asText();
        if (!SORT_COLUMNS.containsKey(s)) {
            throw new InvalidFieldException();
        }
        return s;
    }

    private static String parseSortOrder(JsonNode value) {
        if (isOmitted(value)) {
            return "desc";
        }
        if (!value.isTextual()) {
            throw new InvalidFieldException();
        }
        String s = value.asText();
        if ("asc".equals(s) || "desc".equals(s)) {
            return s;
        }
        throw new InvalidFieldException();
    }

    private static boolean isOmitted(JsonNode value) {
        return value == null || value.isNull() || (value.isTextual() && value.asText().isEmpty());
    }

    private static String stringValue(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static String formatBorrowedAt(Object value) {
        if (value == null) {
            return null;
        }
        LocalDateTime ldt;
        if (value instanceof Timestamp ts) {
            ldt = ts.toLocalDateTime();
        } else if (value instanceof LocalDateTime dt) {
            ldt = dt;
        } else if (value instanceof java.util.Date d) {
            ldt = LocalDateTime.ofInstant(d.toInstant(), SHANGHAI);
        } else {
            return String.valueOf(value);
        }
        int nano = ldt.getNano();
        if (nano == 0) {
            return OUTPUT_NO_FRACTION.format(ldt);
        }
        return OUTPUT_WITH_FRACTION.format(ldt);
    }

    public record ReportQueryResult(
            List<Map<String, Object>> rows,
            String sqlTemplate,
            List<Object> parameters
    ) {
    }

    public static class InvalidFieldException extends RuntimeException {
    }
}