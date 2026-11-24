package edu.library.identity;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class IdentityContractTest {
    private final ApplicationAvailability availability = mock(ApplicationAvailability.class);

    @Test
    void readyOnlyAfterStartupRunnersFinish() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new IdentityController(
                mock(IamUsers.class), new Passwords(), new Sessions(), availability, "")).build();
        when(availability.getReadinessState())
                .thenReturn(ReadinessState.REFUSING_TRAFFIC, ReadinessState.ACCEPTING_TRAFFIC);
        mvc.perform(get("/auth/ready")).andExpect(status().isServiceUnavailable());
        mvc.perform(get("/auth/ready")).andExpect(status().isOk());
    }

    @Test
    void loginIssuesABearerBoundToTheActiveDatabaseUser() throws Exception {
        var users = mock(IamUsers.class);
        var passwords = new Passwords();
        var sessions = new Sessions();
        var mvc = MockMvcBuilders.standaloneSetup(new IdentityController(users, passwords, sessions, availability, "")).build();
        String hash = passwords.encode("correct-test-passphrase");
        when(users.enabledCredential("reader01")).thenReturn(Optional.of(new IamUsers.Credential(1, hash)));
        when(users.enabledUser(1)).thenReturn(Optional.of(new IamUsers.User(1,"reader01","读者一号",List.of("READER"))));

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
    void syncTokenIdentifiesOnlyTheMachineAccount() throws Exception {
        var users = mock(IamUsers.class);
        var sessions = new Sessions();
        String token = UUID.randomUUID().toString();
        var mvc = MockMvcBuilders.standaloneSetup(new IdentityController(users, new Passwords(), sessions, availability, token)).build();
        mvc.perform(get("/users/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"id\":0,\"username\":\"sync-bot\",\"roles\":[\"SYNC\"]}", true));
        mvc.perform(get("/users/me").header("Authorization", "Bearer " + UUID.randomUUID()))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"sync-bot\",\"password\":\"" + token + "\"}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(users);
        assertTrue(sessions.authenticate("Bearer " + token).isEmpty());
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
