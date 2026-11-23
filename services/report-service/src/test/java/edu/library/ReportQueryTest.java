package edu.library;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.hamcrest.Matchers.containsString;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class ReportQueryTest {

    private static final String ANALYST_TOKEN = "Bearer analyst-token";
    private static final String READER_TOKEN = "Bearer reader-token";

    private ObjectMapper objectMapper;
    private ReportDatabases databases;
    private JdbcTemplate analystTemplate;
    private JdbcTemplate syncTemplate;
    private ReportQueryService reportQueryService;
    private ReportQueryController controller;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        databases = mock(ReportDatabases.class);
        analystTemplate = mock(JdbcTemplate.class);
        syncTemplate = mock(JdbcTemplate.class);
        when(databases.analyst()).thenReturn(analystTemplate);
        when(databases.sync()).thenReturn(syncTemplate);
        when(analystTemplate.queryForList(anyString(), any(Object[].class))).thenReturn(java.util.List.of());

        IdentityGate.IdentityHttpClient identityHttp = (url, authorization) -> {
            if (ANALYST_TOKEN.equals(authorization)) {
                return new IdentityGate.IdentityHttpResponse(200,
                        "{\"id\":1,\"username\":\"analyst\",\"roles\":[\"ANALYST\"]}");
            }
            if (READER_TOKEN.equals(authorization)) {
                return new IdentityGate.IdentityHttpResponse(200,
                        "{\"id\":2,\"username\":\"reader\",\"roles\":[\"READER\"]}");
            }
            return new IdentityGate.IdentityHttpResponse(401, "{}");
        };

        IdentityGate identityGate = new IdentityGate("http://test/users/me", identityHttp, objectMapper);
        reportQueryService = new ReportQueryService(databases);
        controller = new ReportQueryController(identityGate, reportQueryService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller).build();
    }

    @Test
    void q1_analyst_categoryId1() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", ANALYST_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"categoryId\":1}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sqlTemplate").value(containsString("c.category_id = ?")))
                .andExpect(jsonPath("$.parameters[0]").value(1));
    }

    @Test
    void q2_analyst_statusReturned() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", ANALYST_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"BORROWED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sqlTemplate").value(containsString("lf.status = ?")))
                .andExpect(jsonPath("$.parameters[0]").value("BORROWED"));

        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", ANALYST_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"RETURNED\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sqlTemplate").value(containsString("lf.status = ?")))
                .andExpect(jsonPath("$.parameters[0]").value("RETURNED"));
    }

    @Test
    void q3_analyst_sortByPassword_invalidField() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", ANALYST_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sortBy\":\"password\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FIELD"));

        verify(analystTemplate, never()).queryForList(anyString(), any(Object[].class));
        verify(syncTemplate, never()).queryForList(anyString(), any(Object[].class));
    }

    @Test
    void q4_analyst_extraKeyIgnored() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", ANALYST_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"categoryId\":1,\"evil\":\"1;DROP TABLE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sqlTemplate").value(org.hamcrest.Matchers.not(containsString("DROP TABLE"))))
                .andExpect(jsonPath("$.sqlTemplate").value(org.hamcrest.Matchers.not(containsString("evil"))));
    }

    @Test
    void q5_noToken_unauthorized() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void expiredTokenIsUnauthorized() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", "Bearer expired")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void q6_reader_forbidden() throws Exception {
        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", READER_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void q7_analystUser_and_analystJdbc() throws Exception {
        assertEquals("db_report_analyst01", ReportDatabases.ANALYST_USER);

        mockMvc.perform(post("/api/reports/query")
                        .header("Authorization", ANALYST_TOKEN)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"));

        verify(databases).analyst();
        verify(databases, never()).sync();
        verify(analystTemplate).queryForList(anyString(), any(Object[].class));
        verify(syncTemplate, never()).queryForList(anyString(), any(Object[].class));
    }
}
