package edu.library.identity;

import java.util.UUID;
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
    private final String dummyHash;

    IdentityController(IamUsers users, Passwords passwords, Sessions sessions) {
        this.users = users;
        this.passwords = passwords;
        this.sessions = sessions;
        this.dummyHash = passwords.encode(UUID.randomUUID().toString());
    }

    @PostMapping("/auth/login")
    ResponseEntity<Token> login(@RequestBody Login login) {
        if (login.username() == null || login.username().isBlank() || login.username().length() > 64
                || login.password() == null || login.password().isEmpty() || login.password().length() > 256) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
        }
        var credential = users.enabledCredential(login.username())
                .filter(record -> !"REPLACE_WITH_HASH".equals(record.passwordHash()));
        String hash = credential.map(IamUsers.Credential::passwordHash).orElse(dummyHash);
        if (!passwords.matches(login.password(), hash) || credential.isEmpty()) throw unauthorized();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Token(sessions.issue(credential.get().id()), "Bearer", Sessions.TTL_SECONDS));
    }

    @GetMapping("/users/me")
    ResponseEntity<IamUsers.User> me(@RequestHeader(value="Authorization", required=false) String header) {
        long id = sessions.authenticate(header).orElseThrow(IdentityController::unauthorized);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(users.enabledUser(id).orElseThrow(IdentityController::unauthorized));
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Void> unavailable() { return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build(); }

    private static ResponseStatusException unauthorized() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED);
    }
}
