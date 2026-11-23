package edu.library;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class ReportSyncController {

    private final IdentityGate identityGate;
    private final LoanSyncService loanSyncService;

    public ReportSyncController(IdentityGate identityGate, LoanSyncService loanSyncService) {
        this.identityGate = identityGate;
        this.loanSyncService = loanSyncService;
    }

    @PostMapping(path = "/api/reports/sync", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> sync(
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        identityGate.requireAnalyst(authorization);
        loanSyncService.syncLoans();
        List<Map<String, Object>> sources = loanSyncService.readAllSourceStatuses();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("sources", sources);
        return ResponseEntity.ok(body);
    }

    @ExceptionHandler(IdentityGate.UnauthorizedException.class)
    public ResponseEntity<Void> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }

    @ExceptionHandler(IdentityGate.ForbiddenException.class)
    public ResponseEntity<Void> forbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }

    @ExceptionHandler(IdentityGate.IdentityUnavailableException.class)
    public ResponseEntity<Map<String, String>> identityUnavailable() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("code", "IDENTITY_UNAVAILABLE"));
    }
}