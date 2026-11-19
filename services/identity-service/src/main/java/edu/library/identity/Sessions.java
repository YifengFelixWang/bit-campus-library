package edu.library.identity;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.OptionalLong;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
final class Sessions {
    static final int TTL_SECONDS = 3600;
    private record Session(long userId, Instant expiresAt) {}
    private final ConcurrentHashMap<String, Session> entries = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final Clock clock;

    Sessions() { this(Clock.systemUTC()); }
    Sessions(Clock clock) { this.clock = clock; }

    String issue(long userId) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        entries.put(token, new Session(userId, clock.instant().plusSeconds(TTL_SECONDS)));
        return token;
    }

    OptionalLong authenticate(String authorization) {
        if (authorization == null || authorization.length() != 50 || !authorization.startsWith("Bearer ")) {
            return OptionalLong.empty();
        }
        String token = authorization.substring(7);
        Session session = entries.get(token);
        if (session == null) return OptionalLong.empty();
        if (!clock.instant().isBefore(session.expiresAt())) {
            entries.remove(token, session);
            return OptionalLong.empty();
        }
        return OptionalLong.of(session.userId());
    }

    @Scheduled(fixedDelay = 300_000)
    void purgeExpired() {
        Instant now = clock.instant();
        entries.values().removeIf(session -> !now.isBefore(session.expiresAt()));
    }
}
