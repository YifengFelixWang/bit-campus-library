package edu.library;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.sun.net.httpserver.HttpServer;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.hamcrest.MatcherAssert.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LoanSyncTest {

    private HikariDataSource dataSource;
    private JdbcTemplate syncTemplate;
    private ReportDatabases databases;
    private TransactionTemplate syncTransaction;
    private HttpServer httpServer;
    private String loanServiceBaseUrl;
    private final List<String> requestPaths = new ArrayList<>();
    private int httpPage;

    @BeforeEach
    void setUp() throws IOException {
        requestPaths.clear();
        httpPage = 0;
        HikariDataSource ds = new HikariDataSource();
        ds.setJdbcUrl("jdbc:h2:mem:loan_sync_" + System.nanoTime()
                + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH");
        ds.setUsername("sa");
        ds.setPassword("");
        ds.setMaximumPoolSize(4);
        dataSource = ds;
        syncTemplate = new JdbcTemplate(dataSource);
        syncTransaction = new TransactionTemplate(new DataSourceTransactionManager(dataSource));
        initSchema();
        databases = mock(ReportDatabases.class);
        JdbcTemplate analystTemplate = mock(JdbcTemplate.class);
        when(analystTemplate.queryForList(anyString(), any(Object[].class))).thenReturn(List.of());
        when(databases.analyst()).thenReturn(analystTemplate);
        when(databases.sync()).thenReturn(syncTemplate);
        when(databases.syncPool()).thenReturn(dataSource);
        startHttpServer();
    }

    @AfterEach
    void tearDown() {
        if (httpServer != null) {
            httpServer.stop(0);
        }
        if (dataSource != null) {
            dataSource.close();
        }
    }

    @Test
    void y1_newLoan_writesFactAndAdvancesCursor() {
        String body = pageJson(List.of(item(6, 2, 4, 4, "RETURNED",
                "2026-06-01T10:00", "2026-06-30T10:00", "2026-06-20T10:00:00.123456",
                "2026-06-20T10:00:00.123456", false)), "2026-06-20T10:00:00.123456", 6, false);
        configureHttp(body);

        LoanSyncService service = service("sync-bot-secret");
        service.syncLoans();

        Map<String, Object> row = loanFact(6);
        assertEquals(2L, ((Number) row.get("user_id")).longValue());
        assertEquals(4L, ((Number) row.get("book_id")).longValue());
        assertEquals("RETURNED", row.get("status"));

        Map<String, Object> cp = loanCheckpoint();
        assertEquals("OK", cp.get("status"));
        assertEquals(6L, ((Number) cp.get("cursor_id")).longValue());
        assertEquals(java.sql.Timestamp.valueOf("2026-06-20 10:00:00.123456"), cp.get("cursor_updated_at"));
    }

    @Test
    void y2_sameLoanId_updatesRowWithoutInsertingAnother() {
        seedLoanFact(6, 2, 3, 4, "BORROWED", false);
        String body = pageJson(List.of(item(6, 2, 4, 99, "RETURNED",
                "2026-06-01T10:00:00", "2026-06-30T10:00:00", "2026-06-20T10:00:00",
                "2026-06-21T10:00:00", false)), "2026-06-21T10:00:00", 6, false);
        configureHttp(body);

        LoanSyncService service = service("sync-bot-secret");
        service.syncLoans();

        assertEquals(1, countLoanFacts());
        Map<String, Object> row = loanFact(6);
        assertEquals(99L, ((Number) row.get("book_id")).longValue());
        assertEquals("RETURNED", row.get("status"));
    }

    @Test
    void y3_deletedStillStored_querySqlFiltersDeleted() {
        String body = pageJson(List.of(item(7, 2, 4, 4, "RETURNED",
                "2026-06-01T10:00:00", "2026-06-30T10:00:00", "2026-06-20T10:00:00",
                "2026-06-22T10:00:00", true)), "2026-06-22T10:00:00", 7, false);
        configureHttp(body);

        LoanSyncService service = service("sync-bot-secret");
        service.syncLoans();

        Map<String, Object> row = loanFact(7);
        assertTrue((Boolean) row.get("deleted"));

        String sql = new ReportQueryService(databases)
                .query(JsonNodeFactory.instance.objectNode())
                .sqlTemplate();
        assertThat(sql, containsString("lf.deleted = FALSE"));
    }

    @Test
    void y4_secondWriteFailureRollsBackEntirePage_cursorUnchanged_statusError() {
        String body = pageJson(List.of(
                item(10, 2, 4, 4, "BORROWED", "2026-06-01T10:00:00", "2026-06-30T10:00:00", null,
                        "2026-06-23T10:00:00", false),
                item(11, 2, 5, 5, "BORROWED", "2026-06-02T10:00:00", "2026-06-30T10:00:00", null,
                        "2026-06-23T11:00:00", false)
        ), "2026-06-23T11:00:00", 11, false);
        configureHttp(body);

        FailingJdbcTemplate failing = new FailingJdbcTemplate(syncTemplate, 2);
        when(databases.sync()).thenReturn(failing);

        Map<String, Object> before = loanCheckpoint();
        LoanSyncService service = new LoanSyncService(
                databases, new JdkLoanChangesClient(), syncTransaction, loanServiceBaseUrl, "sync-bot-secret");
        service.syncLoans();

        assertEquals(0, countLoanFacts());
        Map<String, Object> after = loanCheckpoint();
        assertEquals(before.get("cursor_id"), after.get("cursor_id"));
        assertEquals(before.get("cursor_updated_at"), after.get("cursor_updated_at"));
        assertEquals("ERROR", after.get("status"));
        assertNotNull(after.get("last_error"));
    }

    @Test
    void y5_missingToken_doesNotCallLoanService_recordsError() {
        LoanSyncService service = service("");
        service.syncLoans();

        assertTrue(requestPaths.isEmpty());
        Map<String, Object> cp = loanCheckpoint();
        assertEquals("ERROR", cp.get("status"));
        assertNotNull(cp.get("last_error"));
        assertThat(cp.get("last_error").toString(), containsString("缺少 sync-bot 令牌"));
    }

    @Test
    void y6_fullPageWithHasMore_usesNextCursorOnSecondRequest() {
        List<String> items = new ArrayList<>();
        for (int i = 1; i <= 100; i++) {
            items.add(item(i, 2, i, 4, "BORROWED",
                    "2026-06-01T10:00:00", "2026-06-30T10:00:00", null,
                    "2026-06-24T10:00:00", false));
        }
        String page1 = pageJson(items, "2026-06-24T10:00:00", 100, true);
        String page2 = pageJson(List.of(item(101, 2, 101, 4, "RETURNED",
                "2026-06-02T10:00:00", "2026-06-30T10:00:00", "2026-06-25T10:00:00",
                "2026-06-25T10:00:00", false)), "2026-06-25T10:00:00", 101, false);
        configurePagedHttp(page1, page2);

        LoanSyncService service = service("sync-bot-secret");
        service.syncLoans();

        assertEquals(2, requestPaths.size());
        assertThat(requestPaths.get(0), containsString("afterTime=1970-01-01T00%3A00%3A00"));
        assertThat(requestPaths.get(0), containsString("afterId=0"));
        assertThat(requestPaths.get(0), containsString("limit=100"));
        assertThat(requestPaths.get(1), containsString("afterTime=2026-06-24T10%3A00%3A00"));
        assertThat(requestPaths.get(1), containsString("afterId=100"));
        assertEquals(101, countLoanFacts());
    }

    @Test
    void emptyPageAfterErrorClearsErrorAndKeepsCursor() {
        service("").syncLoans();
        configureHttp(pageJson(List.of(), "1970-01-01T00:00:00", 0, false));
        service("valid-token").syncLoans();

        Map<String, Object> cp = loanCheckpoint();
        assertEquals("OK", cp.get("status"));
        org.junit.jupiter.api.Assertions.assertNull(cp.get("last_error"));
        org.junit.jupiter.api.Assertions.assertNull(cp.get("cursor_updated_at"));
        assertNotNull(cp.get("last_success_at"));
    }

    private LoanSyncService service(String token) {
        return new LoanSyncService(
                databases,
                new JdkLoanChangesClient(),
                syncTransaction,
                loanServiceBaseUrl,
                token
        );
    }

    private void initSchema() {
        syncTemplate.execute("CREATE SCHEMA IF NOT EXISTS report");
        syncTemplate.execute("""
                CREATE TABLE IF NOT EXISTS report.loan_fact (
                    loan_id BIGINT PRIMARY KEY,
                    user_id BIGINT NOT NULL,
                    book_id BIGINT NOT NULL,
                    copy_id BIGINT NOT NULL,
                    status VARCHAR(32) NOT NULL,
                    borrowed_at TIMESTAMP NOT NULL,
                    due_at TIMESTAMP,
                    returned_at TIMESTAMP,
                    source_updated_at TIMESTAMP NOT NULL,
                    synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    deleted BOOLEAN NOT NULL DEFAULT FALSE
                )
                """);
        syncTemplate.execute("""
                CREATE TABLE IF NOT EXISTS report.sync_checkpoint (
                    source_name VARCHAR(32) PRIMARY KEY,
                    cursor_updated_at TIMESTAMP,
                    cursor_id BIGINT,
                    last_success_at TIMESTAMP,
                    last_error VARCHAR(500),
                    status VARCHAR(32) NOT NULL
                )
                """);
        syncTemplate.update(
                "INSERT INTO report.sync_checkpoint (source_name, status) VALUES (?, ?)",
                "iam", "SEED");
        syncTemplate.update(
                "INSERT INTO report.sync_checkpoint (source_name, status) VALUES (?, ?)",
                "catalog", "SEED");
        syncTemplate.update(
                "INSERT INTO report.sync_checkpoint (source_name, status) VALUES (?, ?)",
                "loan", "SEED");
    }

    private void seedLoanFact(long loanId, long userId, long bookId, long copyId, String status, boolean deleted) {
        syncTemplate.update("""
                        INSERT INTO report.loan_fact (
                            loan_id, user_id, book_id, copy_id, status,
                            borrowed_at, due_at, returned_at, source_updated_at, synced_at, deleted
                        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)
                        """,
                loanId, userId, bookId, copyId, status, deleted);
    }

    private Map<String, Object> loanFact(long loanId) {
        return syncTemplate.queryForMap("SELECT * FROM report.loan_fact WHERE loan_id = ?", loanId);
    }

    private int countLoanFacts() {
        Integer n = syncTemplate.queryForObject("SELECT COUNT(*) FROM report.loan_fact", Integer.class);
        return n == null ? 0 : n;
    }

    private Map<String, Object> loanCheckpoint() {
        return syncTemplate.queryForMap(
                "SELECT * FROM report.sync_checkpoint WHERE source_name = 'loan'");
    }

    private void startHttpServer() throws IOException {
        httpServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        httpServer.createContext("/api/internal/loans/changes", exchange -> {
            requestPaths.add(exchange.getRequestURI().toString());
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            assertNotNull(auth);
            assertTrue(auth.startsWith("Bearer "));
            byte[] bytes = nextHttpBody().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        httpServer.start();
        loanServiceBaseUrl = "http://127.0.0.1:" + httpServer.getAddress().getPort();
    }

    private String nextHttpBody = "{}";

    private String nextHttpBody() {
        if (pagedBodies != null && httpPage < pagedBodies.size()) {
            return pagedBodies.get(httpPage++);
        }
        return nextHttpBody;
    }

    private List<String> pagedBodies;

    private void configureHttp(String body) {
        pagedBodies = null;
        nextHttpBody = body;
    }

    private void configurePagedHttp(String... bodies) {
        pagedBodies = List.of(bodies);
        httpPage = 0;
    }

    private static String item(
            long loanId, long userId, long copyId, long bookId, String status,
            String borrowedAt, String dueAt, String returnedAt, String updatedAt, boolean deleted
    ) {
        StringBuilder sb = new StringBuilder();
        sb.append("{\"loan_id\":").append(loanId)
                .append(",\"user_id\":").append(userId)
                .append(",\"copy_id\":").append(copyId)
                .append(",\"book_id\":").append(bookId)
                .append(",\"status\":\"").append(status).append("\"")
                .append(",\"borrowed_at\":\"").append(borrowedAt).append("\"");
        if (dueAt == null) {
            sb.append(",\"due_at\":null");
        } else {
            sb.append(",\"due_at\":\"").append(dueAt).append("\"");
        }
        if (returnedAt == null) {
            sb.append(",\"returned_at\":null");
        } else {
            sb.append(",\"returned_at\":\"").append(returnedAt).append("\"");
        }
        sb.append(",\"updated_at\":\"").append(updatedAt).append("\"")
                .append(",\"deleted\":").append(deleted)
                .append("}");
        return sb.toString();
    }

    private static String pageJson(List<String> items, String afterTime, long afterId, boolean hasMore) {
        return "{\"items\":[" + String.join(",", items) + "],"
                + "\"nextCursor\":{\"afterTime\":\"" + afterTime + "\",\"afterId\":" + afterId + "},"
                + "\"hasMore\":" + hasMore + "}";
    }

    static final class FailingJdbcTemplate extends JdbcTemplate {
        private final JdbcTemplate delegate;
        private final int failOnLoanWrite;
        private final AtomicInteger loanWrites = new AtomicInteger();

        FailingJdbcTemplate(JdbcTemplate delegate, int failOnLoanWrite) {
            super(delegate.getDataSource());
            this.delegate = delegate;
            this.failOnLoanWrite = failOnLoanWrite;
        }

        @Override
        public int update(String sql, Object... args) {
            if (sql.contains("loan_fact")) {
                int n = loanWrites.incrementAndGet();
                if (n == failOnLoanWrite) {
                    throw new RuntimeException("Y4 simulated loan_fact write failure");
                }
            }
            return delegate.update(sql, args);
        }

        @Override
        public <T> T queryForObject(String sql, Class<T> requiredType, Object... args) {
            return delegate.queryForObject(sql, requiredType, args);
        }

        @Override
        public List<Map<String, Object>> queryForList(String sql, Object... args) {
            return delegate.queryForList(sql, args);
        }

        @Override
        public Map<String, Object> queryForMap(String sql, Object... args) {
            return delegate.queryForMap(sql, args);
        }

        @Override
        public void execute(String sql) {
            delegate.execute(sql);
        }
    }
}
