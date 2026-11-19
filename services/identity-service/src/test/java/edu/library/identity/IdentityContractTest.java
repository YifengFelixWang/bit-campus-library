package edu.library.identity;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class IdentityContractTest {
    @Test
    void loginIssuesABearerBoundToTheActiveDatabaseUser() throws Exception {
        var users = mock(IamUsers.class);
        var passwords = new Passwords();
        var sessions = new Sessions();
        var mvc = MockMvcBuilders.standaloneSetup(new IdentityController(users, passwords, sessions)).build();
        String hash = passwords.encode("correct-test-passphrase");
        when(users.enabledCredential("reader01")).thenReturn(Optional.of(new IamUsers.Credential(1, hash)));
        when(users.enabledUser(1)).thenReturn(Optional.of(new IamUsers.User(1,"reader01",List.of("READER"))));

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"reader01\",\"password\":\"wrong\"}"))
                .andExpect(status().isUnauthorized());
        var result = mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"reader01\",\"password\":\"correct-test-passphrase\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andReturn();
        String token = new ObjectMapper().readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
        mvc.perform(get("/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"id\":1,\"username\":\"reader01\",\"roles\":[\"READER\"]}", true));
        mvc.perform(get("/users/me").header("Authorization", "Bearer test-stub"))
                .andExpect(status().isUnauthorized());

        when(users.enabledUser(1)).thenReturn(Optional.empty());
        mvc.perform(get("/users/me").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
    }

    @Test
    void twoReaderSessionsRemainDistinctAndExpireAtTheBoundary() {
        var clock = mock(Clock.class);
        when(clock.instant()).thenReturn(Instant.EPOCH);
        var sessions = new Sessions(clock);
        String first = sessions.issue(1);
        String second = sessions.issue(2);
        assertNotEquals(first, second);
        assertEquals(1, sessions.authenticate("Bearer " + first).orElseThrow());
        assertEquals(2, sessions.authenticate("Bearer " + second).orElseThrow());
        when(clock.instant()).thenReturn(Instant.EPOCH.plusSeconds(Sessions.TTL_SECONDS));
        assertTrue(sessions.authenticate("Bearer " + first).isEmpty());
        sessions.purgeExpired();
        assertTrue(sessions.authenticate("Bearer " + second).isEmpty());
    }
}
