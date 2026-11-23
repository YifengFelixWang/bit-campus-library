package edu.library.catalog.config;

import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AuthFilterTest {
    @ParameterizedTest
    @ValueSource(strings = {"OPERATOR", "OPS"})
    void bothOperatorRoleCodesReachTheCatalogAsOps(String roleCode) throws Exception {
        IdentityClient identity = new IdentityClient("http://localhost/users/me") {
            @Override
            public Identity resolve(String bearer) {
                return new Identity(5, "ops1", List.of(roleCode));
            }
        };
        var request = new MockHttpServletRequest("GET", "/api/catalog/whoami");
        request.addHeader("Authorization", "Bearer test-session");
        var filter = new AuthFilter(identity);
        var response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) ->
                response.setHeader("Test-Role", RoleContext.role().name()));
        assertEquals("OPS", response.getHeader("Test-Role"));
    }
}
