package edu.library;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class ReportStatsExportController {

    private final IdentityGate identityGate;
    private final ReportStatsService reportStatsService;
    private final ReportExportService reportExportService;

    public ReportStatsExportController(
            IdentityGate identityGate,
            ReportStatsService reportStatsService,
            ReportExportService reportExportService
    ) {
        this.identityGate = identityGate;
        this.reportStatsService = reportStatsService;
        this.reportExportService = reportExportService;
    }

    @GetMapping(path = "/api/reports/stats", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> stats(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(required = false) String categoryId,
            @RequestParam(required = false) String bookId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        identityGate.requireAnalyst(authorization);
        List<Map<String, Object>> categories = reportStatsService.stats(categoryId, bookId, from, to);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("categories", categories);
        return ResponseEntity.ok(body);
    }

    @GetMapping(path = "/api/reports/export")
    public ResponseEntity<byte[]> export(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(required = false) String categoryId,
            @RequestParam(required = false) String bookId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) String sortBy,
            @RequestParam(required = false) String sortOrder
    ) {
        identityGate.requireAnalyst(authorization);
        byte[] csv = reportExportService.exportCsv(
                categoryId, bookId, status, from, to, sortBy, sortOrder
        );
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv;charset=UTF-8"));
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"report.csv\"");
        return new ResponseEntity<>(csv, headers, HttpStatus.OK);
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