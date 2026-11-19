package edu.library.catalog.config;

import java.time.Duration;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class IdentityClient {
    public record Identity(long id, String username, List<String> roles) {}

    private final RestClient http;
    private final String url;

    public IdentityClient(@Value("${catalog.identity.url}") String url) {
        this.url = url;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(2));
        factory.setReadTimeout(Duration.ofSeconds(3));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    public Identity resolve(String bearer) {
        return http.get().uri(url).header(HttpHeaders.AUTHORIZATION, bearer)
                .retrieve().body(Identity.class);
    }
}
