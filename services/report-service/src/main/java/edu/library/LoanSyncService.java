package edu.library;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import java.util.ArrayList;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class LoanSyncService {

    private static final String SOURCE_LOAN = "loan";
    private static final String DEFAULT_AFTER_TIME = "1970-01-01T00:00:00";
    private static final int PAGE_LIMIT = 100;
    private static final String MISSING_TOKEN_MSG = "缺少 sync-bot 令牌";
    private static final List<String> ALL_SOURCES = List.of("iam", "catalog", SOURCE_LOAN);

    private static final DateTimeFormatter OUTPUT_TIME = new DateTimeFormatterBuilder()
            .appendPattern("yyyy-MM-dd'T'HH:mm:ss")
            .appendFraction(ChronoField.NANO_OF_SECOND, 0, 6, true)
            .toFormatter(Locale.ROOT);

    private final ReportDatabases databases;
    private final LoanChangesClient loanChangesClient;
    private final TransactionTemplate syncTransaction;
    private final String loanServiceUrlOverride;
    private final String syncTokenOverride;

    @Autowired
    public LoanSyncService(ReportDatabases databases, LoanChangesClient loanChangesClient) {
        this(databases, loanChangesClient, null, null, null);
    }

    LoanSyncService(
            ReportDatabases databases,
            LoanChangesClient loanChangesClient,
            TransactionTemplate syncTransaction,
            String loanServiceUrlOverride,
            String syncTokenOverride
    ) {
        this.databases = databases;
        this.loanChangesClient = loanChangesClient;
        this.loanServiceUrlOverride = loanServiceUrlOverride;
        this.syncTokenOverride = syncTokenOverride;
        if (syncTransaction != null) {
            this.syncTransaction = syncTransaction;
        } else {
            DataSourceTransactionManager manager = new DataSourceTransactionManager(databases.syncPool());
            this.syncTransaction = new TransactionTemplate(manager);
        }
    }

    public void syncLoans() {
        String authorization = authorizationHeader();
        if (authorization == null) {
            recordLoanError(MISSING_TOKEN_MSG);
            return;
        }

        JdbcTemplate sync = databases.sync();
        Cursor cursor = readLoanCursor(sync);

        try {
            while (true) {
                LoanChangesClient.LoanChangesPage page = loanChangesClient.fetch(
                        loanServiceUrl(), authorization, cursor.afterTime(), cursor.afterId(), PAGE_LIMIT
                );
                if (page.items().isEmpty()) {
                    sync.update("""
                            UPDATE report.sync_checkpoint
                            SET status = 'OK', last_success_at = CURRENT_TIMESTAMP, last_error = NULL
                            WHERE source_name = ?
                            """, SOURCE_LOAN);
                    break;
                }

                LoanChangesClient.LoanChangeItem lastItem = page.items().get(page.items().size() - 1);
                Cursor expected = cursor;
                boolean applied = Boolean.TRUE.equals(syncTransaction.execute(status -> {
                    // The scheduler and a manual refresh may have fetched the same page.
                    if (advanceLoanCursor(sync, expected, lastItem.updatedAt(), lastItem.loanId())) {
                        upsertPage(sync, page.items());
                        return true;
                    }
                    return false;
                }));
                if (!applied || !page.hasMore()) {
                    break;
                }
                cursor = new Cursor(page.nextAfterTime(), page.nextAfterId());
            }
        } catch (Exception ex) {
            recordLoanError(truncateError(ex));
        }
    }

    public List<Map<String, Object>> readAllSourceStatuses() {
        JdbcTemplate sync = databases.sync();
        List<Map<String, Object>> out = new ArrayList<>(3);
        for (String name : ALL_SOURCES) {
            out.add(readSourceStatus(sync, name));
        }
        return out;
    }

    private Map<String, Object> readSourceStatus(JdbcTemplate sync, String sourceName) {
        List<Map<String, Object>> rows = sync.queryForList(
                """
                SELECT status, last_success_at, last_error
                FROM report.sync_checkpoint
                WHERE source_name = ?
                """,
                sourceName
        );
        Map<String, Object> row = rows.isEmpty() ? Map.of() : rows.get(0);
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("sourceName", sourceName);
        item.put("status", stringValue(row.get("status")));
        item.put("lastSuccessAt", formatTimestamp(row.get("last_success_at")));
        item.put("lastError", stringValue(row.get("last_error")));
        return item;
    }

    private void upsertPage(JdbcTemplate sync, List<LoanChangesClient.LoanChangeItem> items) {
        for (LoanChangesClient.LoanChangeItem item : items) {
            upsertLoan(sync, item);
        }
    }

    private void upsertLoan(JdbcTemplate sync, LoanChangesClient.LoanChangeItem item) {
        int updated = sync.update(
                """
                UPDATE report.loan_fact SET
                    user_id = ?, book_id = ?, copy_id = ?, status = ?,
                    borrowed_at = ?, due_at = ?, returned_at = ?,
                    source_updated_at = ?, synced_at = CURRENT_TIMESTAMP, deleted = ?
                WHERE loan_id = ?
                """,
                item.userId(),
                item.bookId(),
                item.copyId(),
                item.status(),
                Timestamp.valueOf(item.borrowedAt()),
                toTimestamp(item.dueAt()),
                toTimestamp(item.returnedAt()),
                Timestamp.valueOf(item.updatedAt()),
                item.deleted(),
                item.loanId()
        );
        if (updated == 0) {
            sync.update(
                    """
                    INSERT INTO report.loan_fact (
                        loan_id, user_id, book_id, copy_id, status,
                        borrowed_at, due_at, returned_at, source_updated_at, synced_at, deleted
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                    """,
                    item.loanId(),
                    item.userId(),
                    item.bookId(),
                    item.copyId(),
                    item.status(),
                    Timestamp.valueOf(item.borrowedAt()),
                    toTimestamp(item.dueAt()),
                    toTimestamp(item.returnedAt()),
                    Timestamp.valueOf(item.updatedAt()),
                    item.deleted()
            );
        }
    }

    private boolean advanceLoanCursor(JdbcTemplate sync, Cursor expected, LocalDateTime cursorUpdatedAt, long cursorId) {
        return sync.update(
                """
                UPDATE report.sync_checkpoint SET
                    cursor_updated_at = ?, cursor_id = ?,
                    last_success_at = CURRENT_TIMESTAMP,
                    last_error = NULL,
                    status = 'OK'
                WHERE source_name = ?
                  AND COALESCE(cursor_updated_at, TIMESTAMP '1970-01-01 00:00:00') = ?
                  AND COALESCE(cursor_id, 0) = ?
                """,
                Timestamp.valueOf(cursorUpdatedAt),
                cursorId,
                SOURCE_LOAN,
                Timestamp.valueOf(LocalDateTime.parse(expected.afterTime())),
                expected.afterId()
        ) == 1;
    }

    private void recordLoanError(String message) {
        JdbcTemplate sync = databases.sync();
        sync.update(
                """
                UPDATE report.sync_checkpoint SET
                    status = 'ERROR',
                    last_error = ?
                WHERE source_name = ?
                """,
                truncate(message),
                SOURCE_LOAN
        );
    }

    private Cursor readLoanCursor(JdbcTemplate sync) {
        List<Map<String, Object>> rows = sync.queryForList(
                """
                SELECT cursor_updated_at, cursor_id
                FROM report.sync_checkpoint
                WHERE source_name = ?
                """,
                SOURCE_LOAN
        );
        if (rows.isEmpty()) {
            return new Cursor(DEFAULT_AFTER_TIME, 0);
        }
        Map<String, Object> row = rows.get(0);
        Object cursorTime = row.get("cursor_updated_at");
        Object cursorId = row.get("cursor_id");
        if (cursorTime == null || cursorId == null) {
            return new Cursor(DEFAULT_AFTER_TIME, 0);
        }
        return new Cursor(formatForQuery(cursorTime), ((Number) cursorId).longValue());
    }

    private String loanServiceUrl() {
        if (loanServiceUrlOverride != null) {
            return loanServiceUrlOverride;
        }
        String url = System.getenv("LOAN_SERVICE_URL");
        if (url == null || url.isBlank()) {
            return "http://127.0.0.1:18083";
        }
        return url.trim();
    }

    private String authorizationHeader() {
        String raw = syncTokenOverride;
        if (raw == null) {
            raw = System.getenv("REPORT_SYNC_TOKEN");
        }
        if (raw == null || raw.isBlank()) {
            return null;
        }
        raw = raw.trim();
        if (raw.startsWith("Bearer ")) {
            return raw;
        }
        return "Bearer " + raw;
    }

    private static Timestamp toTimestamp(LocalDateTime value) {
        return value == null ? null : Timestamp.valueOf(value);
    }

    private static String formatForQuery(Object timestamp) {
        if (timestamp instanceof Timestamp ts) {
            return OUTPUT_TIME.format(ts.toLocalDateTime());
        }
        if (timestamp instanceof LocalDateTime ldt) {
            return OUTPUT_TIME.format(ldt);
        }
        return timestamp.toString();
    }

    private static String formatTimestamp(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Timestamp ts) {
            return OUTPUT_TIME.format(ts.toLocalDateTime());
        }
        if (value instanceof LocalDateTime ldt) {
            return OUTPUT_TIME.format(ldt);
        }
        return value.toString();
    }

    private static String stringValue(Object value) {
        return value == null ? null : value.toString();
    }

    private static String truncateError(Throwable ex) {
        if (ex.getMessage() != null && !ex.getMessage().isBlank()) {
            return truncate(ex.getMessage());
        }
        return truncate(ex.getClass().getSimpleName());
    }

    private static String truncate(String message) {
        if (message.length() <= 500) {
            return message;
        }
        return message.substring(0, 500);
    }

    private record Cursor(String afterTime, long afterId) {
    }
}
