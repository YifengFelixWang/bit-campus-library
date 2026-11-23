package edu.library;

import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class LoanSyncScheduler {

    private final LoanSyncService loanSyncService;

    public LoanSyncScheduler(LoanSyncService loanSyncService) {
        this.loanSyncService = loanSyncService;
    }

    @Scheduled(fixedDelay = 30000)
    public void runScheduledSync() {
        loanSyncService.syncLoans();
    }
}