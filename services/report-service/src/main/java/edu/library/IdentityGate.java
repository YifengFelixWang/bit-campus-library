package edu.library;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.stereotype.Component;

@Component
public class IdentityGate {

    private static final String DEFAULT_IDENTITY_URL = "http://127.0.0.1:18081/users/me";
    private static final String ANALYST_ROLE = "ANALYST";

    private final String identityUrl;
    private final IdentityHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public IdentityGate() {
        this(defaultIdentityUrl(), new JdkIdentityHttpClient(), new ObjectMapper());
    }

    IdentityGate(IdentityHttpClient httpClient) {
        this(defaultIdentityUrl(), httpClient, new ObjectMapper());
    }

    IdentityGate(String identityUrl, IdentityHttpClient httpClient, ObjectMapper objectMapper) {
        this.identityUrl = identityUrl;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    private static String defaultIdentityUrl() {
        String fromEnv = System.getenv("IDENTITY_URL");
        if (fromEnv == null || fromEnv.isBlank()) {
            return DEFAULT_IDENTITY_URL;
        }
        return fromEnv.trim();
    }

    public void requireAnalyst(String authorization) {
        if (authorization == null || authorization.isBlank()) {
            throw new UnauthorizedException();
        }
        if (!authorization.startsWith("Bearer ")) {
            throw new UnauthorizedException();
        }

        IdentityHttpResponse response;
        try {
            response = httpClient.get(identityUrl, authorization);
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new IdentityUnavailableException();
        }

        if (response.statusCode() == 401) {
            throw new UnauthorizedException();
        }
        if (response.statusCode() == 403) {
            throw new ForbiddenException();
        }
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IdentityUnavailableException();
        }

        JsonNode root;
        try {
            root = objectMapper.readTree(response.body());
        } catch (IOException e) {
            throw new IdentityUnavailableException();
        }

        JsonNode rolesNode = root.get("roles");
        if (rolesNode == null || !rolesNode.isArray()) {
            throw new ForbiddenException();
        }

        boolean analyst = false;
        for (JsonNode role : rolesNode) {
            if (role.isTextual() && ANALYST_ROLE.equals(role.asText())) {
                analyst = true;
                break;
            }
        }
        if (!analyst) {
            throw new ForbiddenException();
        }
    }

    public interface IdentityHttpClient {
        IdentityHttpResponse get(String url, String authorization) throws IOException, InterruptedException;
    }

    public record IdentityHttpResponse(int statusCode, String body) {
    }

    static final class JdkIdentityHttpClient implements IdentityHttpClient {
        private final HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();

        @Override
        public IdentityHttpResponse get(String url, String authorization) throws IOException, InterruptedException {
            HttpRequest request = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", authorization)
                    .GET()
                    .build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            return new IdentityHttpResponse(response.statusCode(), response.body());
        }
    }

    public static class UnauthorizedException extends RuntimeException {
    }

    public static class ForbiddenException extends RuntimeException {
    }

    public static class IdentityUnavailableException extends RuntimeException {
    }
}
