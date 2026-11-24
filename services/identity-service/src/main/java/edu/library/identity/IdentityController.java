package edu.library.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
class IdentityController {
    record Login(String username, String password) {}
    record Token(String accessToken, String tokenType, int expiresIn) {}

    private final IamUsers users;
    private final Passwords passwords;
    private final Sessions sessions;
    private final ApplicationAvailability availability;
    private final String dummyHash;
    private static final IamUsers.User SYNC_BOT = new IamUsers.User(0, "sync-bot", "sync-bot", List.of("SYNC"));
    private final byte[] syncAuthorization;

    IdentityController(IamUsers users, Passwords passwords, Sessions sessions, ApplicationAvailability availability,
                       @Value("${REPORT_SYNC_TOKEN:}") String syncToken) {
        this.users = users;
        this.passwords = passwords;
        this.sessions = sessions;
        this.availability = availability;
        this.dummyHash = passwords.encode(UUID.randomUUID().toString());
        if (!syncToken.isEmpty() && !syncToken.matches("[a-zA-Z0-9._~+/-]{32,}={0,2}")) {
            throw new IllegalArgumentException("REPORT_SYNC_TOKEN must be a raw bearer token of at least 32 characters");
        }
        this.syncAuthorization = syncToken.isEmpty() ? null : ("Bearer " + syncToken).getBytes(StandardCharsets.UTF_8);
    }

    @GetMapping("/auth/ready")
    ResponseEntity<Void> ready() {
        HttpStatus status = availability.getReadinessState() == ReadinessState.ACCEPTING_TRAFFIC
                ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).build();
    }

    @PostMapping("/auth/login")
    ResponseEntity<Token> login(@RequestBody Login login) {
        if (login.username() == null || login.username().isBlank() || login.username().length() > 64
                || login.password() == null || login.password().isEmpty() || login.password().length() > 256) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        if (SYNC_BOT.username().equals(login.username())) throw unauthorized();
        var credential = users.enabledCredential(login.username())
                .filter(record -> !"REPLACE_WITH_HASH".equals(record.passwordHash()));
        String hash = credential.map(IamUsers.Credential::passwordHash).orElse(dummyHash);
        if (!passwords.matches(login.password(), hash) || credential.isEmpty()) throw unauthorized();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Token(sessions.issue(credential.get().id()), "Bearer", Sessions.TTL_SECONDS));
    }

    @GetMapping("/users/me")
    ResponseEntity<IamUsers.User> me(@RequestHeader(value="Authorization", required=false) String header) {
        if (syncAuthorization != null && header != null &&
                MessageDigest.isEqual(syncAuthorization, header.getBytes(StandardCharsets.UTF_8))) {
            return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(SYNC_BOT);
        }
        long id = sessions.authenticate(header).orElseThrow(IdentityController::unauthorized);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(users.enabledUser(id).filter(user -> !SYNC_BOT.username().equals(user.username()))
                        .orElseThrow(IdentityController::unauthorized));
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Void> unavailable() { return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build(); }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }
}
