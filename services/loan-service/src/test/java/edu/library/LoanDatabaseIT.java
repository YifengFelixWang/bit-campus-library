package edu.library;

import static org.junit.jupiter.api.Assertions.*;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.StandardEnvironment;

/** Explicit integration test on an initialized development database; all writes roll back. */
class LoanDatabaseIT {
    private static final class RollbackProbe extends RuntimeException {}

    @Test
    void readerBorrowsAndReturnsUsingTheApplicationPool() {
        var sessions = new DatabaseSessions(new StandardEnvironment());
        String request = "integration-" + UUID.randomUUID();
        long loan = Ids.next();
        try {
            assertThrows(RollbackProbe.class, () -> sessions.transaction(1, db -> {
                assertEquals("db_loan_reader01", db.queryForObject("select session_user", String.class));
                long copy = db.queryForObject(
                    "select min(copy_id) from loan.book_copy where status='AVAILABLE'", Long.class);
                db.query("call loan.sp_borrow_copy(?,?,?,?,?)", rs -> null, 1L, copy, 14, request, loan);
                db.query("call loan.sp_borrow_copy(?,?,?,?,?)", rs -> null, 1L, copy, 14, request, Ids.next());
                assertEquals("BORROWED", db.queryForObject(
                    "select status from loan.loan_record where loan_id=?", String.class, loan));
                db.query("call loan.sp_return_copy(?,?)", rs -> null, loan, request + "-ret");
                assertEquals("RETURNED", db.queryForObject(
                    "select status from loan.loan_record where loan_id=?", String.class, loan));
                assertEquals("AVAILABLE", db.queryForObject(
                    "select status from loan.book_copy where copy_id=?", String.class, copy));
                assertEquals(2, db.queryForObject(
                    "select count(*) from loan.loan_audit where loan_id=?", Integer.class, loan));
                throw new RollbackProbe();
            }));
            assertEquals(0, sessions.db(1).queryForObject(
                    "select count(*) from loan.loan_record where loan_id=?", Integer.class, loan));
        } finally {
            sessions.close();
        }
    }
}
