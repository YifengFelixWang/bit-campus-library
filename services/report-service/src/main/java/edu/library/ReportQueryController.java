package edu.library;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
public class ReportQueryController {

    private final IdentityGate identityGate;
    private final ReportQueryService reportQueryService;

    public ReportQueryController(IdentityGate identityGate, ReportQueryService reportQueryService) {
        this.identityGate = identityGate;
        this.reportQueryService = reportQueryService;
    }

    @PostMapping(path = "/api/reports/query", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> query(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody JsonNode body
    ) {
        identityGate.requireAnalyst(authorization);
        ReportQueryService.ReportQueryResult result = reportQueryService.query(body);
        Map<String, Object> bodyOut = new LinkedHashMap<>();
        bodyOut.put("rows", result.rows());
        bodyOut.put("sqlTemplate", result.sqlTemplate());
        bodyOut.put("parameters", result.parameters());
        return ResponseEntity.ok(bodyOut);
    }

    @ExceptionHandler(IdentityGate.UnauthorizedException.class)
    public ResponseEntity<Void> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }

    @ExceptionHandler(IdentityGate.ForbiddenException.class)
    public ResponseEntity<Void> forbidden() {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
    }

    @ExceptionHandler(ReportQueryService.InvalidFieldException.class)
    public ResponseEntity<Map<String, String>> invalidField() {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(Map.of("code", "INVALID_FIELD"));
    }

    @ExceptionHandler(IdentityGate.IdentityUnavailableException.class)
    public ResponseEntity<Map<String, String>> identityUnavailable() {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("code", "IDENTITY_UNAVAILABLE"));
    }
}