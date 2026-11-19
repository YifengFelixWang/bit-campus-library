package edu.library.identity;

import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/** Lets the login page display the database session actually opened by the loan service. */
@RestController
class BorrowingIdentityController {
    private final RestClient loan;

    BorrowingIdentityController(@Value("${LOAN_SERVICE_URL:http://127.0.0.1:8083}") String baseUrl) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(12));
        this.loan = RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @GetMapping("/demo/loan-identity")
    ResponseEntity<String> getLoanIdentity(
            @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authorization) {
        if (authorization == null || !authorization.startsWith("Bearer ")) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        try {
            var result = loan.get().uri("/api/me")
                    .header(HttpHeaders.AUTHORIZATION, authorization)
                    .retrieve().body(String.class);
            return ResponseEntity.ok().cacheControl(org.springframework.http.CacheControl.noStore())
                    .contentType(MediaType.APPLICATION_JSON).body(result);
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(e.getStatusCode()).build();
        } catch (RestClientException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }
}
