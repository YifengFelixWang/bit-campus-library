package edu.library;

import java.io.IOException;
import java.util.List;

public interface LoanChangesClient {

    LoanChangesPage fetch(String loanServiceUrl, String authorization, String afterTime, long afterId, int limit)
            throws IOException, InterruptedException;

    record LoanChangesPage(
            List<LoanChangeItem> items,
            String nextAfterTime,
            long nextAfterId,
            boolean hasMore
    ) {
    }

    record LoanChangeItem(
            long loanId,
            long userId,
            long copyId,
            long bookId,
            String status,
            java.time.LocalDateTime borrowedAt,
            java.time.LocalDateTime dueAt,
            java.time.LocalDateTime returnedAt,
            java.time.LocalDateTime updatedAt,
            boolean deleted
    ) {
    }
}