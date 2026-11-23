package edu.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.List;

@Component
public class JdkLoanChangesClient implements LoanChangesClient {

    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public JdkLoanChangesClient() {
        this(HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build(), new ObjectMapper());
    }

    JdkLoanChangesClient(HttpClient httpClient, ObjectMapper objectMapper) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public LoanChangesPage fetch(String loanServiceUrl, String authorization, String afterTime, long afterId, int limit)
            throws IOException, InterruptedException {
        String base = loanServiceUrl.endsWith("/") ? loanServiceUrl.substring(0, loanServiceUrl.length() - 1) : loanServiceUrl;
        String url = base + "/api/internal/loans/changes"
                + "?afterTime=" + encode(afterTime)
                + "&afterId=" + afterId
                + "&limit=" + limit;

        HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(30))
                .header("Authorization", authorization)
                .GET()
                .build();
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("loan changes HTTP " + response.statusCode() + ": " + response.body());
        }

        JsonNode root = objectMapper.readTree(response.body());
        List<LoanChangeItem> items = new ArrayList<>();
        JsonNode itemsNode = root == null ? null : root.get("items");
        if (itemsNode == null || !itemsNode.isArray()) {
            throw new IOException("loan changes response missing items");
        }
        for (JsonNode node : itemsNode) {
            items.add(parseItem(node));
        }

        JsonNode next = root.get("nextCursor");
        String nextAfterTime = next != null && next.hasNonNull("afterTime") ? next.get("afterTime").asText() : afterTime;
        long nextAfterId = next != null && next.hasNonNull("afterId") ? next.get("afterId").asLong() : afterId;
        boolean hasMore = root.has("hasMore") && root.get("hasMore").asBoolean();
        return new LoanChangesPage(items, nextAfterTime, nextAfterId, hasMore);
    }

    private static LoanChangeItem parseItem(JsonNode node) {
        return new LoanChangeItem(
                node.get("loan_id").asLong(),
                node.get("user_id").asLong(),
                node.get("copy_id").asLong(),
                node.get("book_id").asLong(),
                node.get("status").asText(),
                parseDateTime(node.get("borrowed_at")),
                parseNullableDateTime(node.get("due_at")),
                parseNullableDateTime(node.get("returned_at")),
                parseDateTime(node.get("updated_at")),
                node.has("deleted") && node.get("deleted").asBoolean()
        );
    }

    private static LocalDateTime parseDateTime(JsonNode node) {
        if (node == null || node.isNull()) {
            throw new DateTimeParseException("missing datetime", "", 0);
        }
        return LocalDateTime.parse(node.asText());
    }

    private static LocalDateTime parseNullableDateTime(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        String text = node.asText();
        if (text.isBlank()) {
            return null;
        }
        return LocalDateTime.parse(text);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
