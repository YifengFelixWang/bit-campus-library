package edu.library;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoField;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Service
public class ReportStatsService {

    private static final String SQL_BASE = """
            SELECT c.category_id, c.category_name,
                   COUNT(*) AS loan_count,
                   SUM(CASE WHEN lf.status = 'BORROWED' THEN 1 ELSE 0 END) AS open_count
            FROM report.loan_fact lf
            JOIN report.book_dim b ON b.book_id = lf.book_id AND b.deleted = FALSE
            JOIN report.category_dim c ON c.category_id = b.category_id AND c.deleted = FALSE
            WHERE lf.deleted = FALSE""";

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

    private final ReportDatabases databases;

    public ReportStatsService(ReportDatabases databases) {
        this.databases = databases;
    }

    public List<Map<String, Object>> stats(
            String categoryIdParam,
            String bookIdParam,
            String fromParam,
            String toParam
    ) {
        Long categoryId = parseOptionalPositiveLong(categoryIdParam);
        Long bookId = parseOptionalPositiveLong(bookIdParam);
        LocalDateTime from = parseOptionalDateTime(fromParam);
        LocalDateTime to = parseOptionalDateTime(toParam);

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
        if (from != null) {
            sql.append("\nAND lf.borrowed_at >= ?");
            parameters.add(Timestamp.valueOf(from));
        }
        if (to != null) {
            sql.append("\nAND lf.borrowed_at <= ?");
            parameters.add(Timestamp.valueOf(to));
        }

        sql.append("\nGROUP BY c.category_id, c.category_name");
        sql.append("\nORDER BY c.category_id");

        JdbcTemplate analyst = databases.analyst();
        List<Map<String, Object>> rawRows = analyst.queryForList(sql.toString(), parameters.toArray());

        List<Map<String, Object>> categories = new ArrayList<>(rawRows.size());
        for (Map<String, Object> raw : rawRows) {
            Map<String, Object> cat = new LinkedHashMap<>();
            cat.put("categoryId", numberValue(raw.get("category_id")));
            cat.put("categoryName", stringValue(raw.get("category_name")));
            cat.put("loanCount", numberValue(raw.get("loan_count")));
            cat.put("openCount", numberValue(raw.get("open_count")));
            categories.add(cat);
        }
        return categories;
    }

    private static Long parseOptionalPositiveLong(String param) {
        if (param == null || param.isBlank()) {
            return null;
        }
        try {
            long n = Long.parseLong(param.trim());
            if (n <= 0) {
                throw new ReportQueryService.InvalidFieldException();
            }
            return n;
        } catch (NumberFormatException e) {
            throw new ReportQueryService.InvalidFieldException();
        }
    }

    private static LocalDateTime parseOptionalDateTime(String param) {
        if (param == null || param.isBlank()) {
            return null;
        }
        try {
            return LocalDateTime.parse(param.trim(), DATE_TIME_PARSER);
        } catch (DateTimeParseException e) {
            throw new ReportQueryService.InvalidFieldException();
        }
    }

    private static String stringValue(Object v) {
        return v == null ? null : String.valueOf(v);
    }

    private static Number numberValue(Object v) {
        if (v == null) {
            return 0;
        }
        if (v instanceof Number n) {
            return n;
        }
        return Long.parseLong(String.valueOf(v));
    }
}