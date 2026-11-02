package com.rjgehan.notes.config;

import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.rjgehan.notes.api.error.Problems;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.identity.IdentityResolver;
import com.rjgehan.notes.support.TestProperties;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.assertj.core.api.Assertions.assertThat;

class HostAndIdentityFilterTest {

	private static HostAndIdentityFilter filter(Map<String, String> overrides) {
		Map<String, String> properties = new HashMap<>();
		properties.put("notes.allowed-hosts", "notes.example.ts.net,localhost:8080");
		properties.putAll(overrides);
		NotesProperties notes = TestProperties.forVault(Path.of("vault"), properties);
		return new HostAndIdentityFilter(notes, new IdentityResolver(notes), new Problems(JsonMapper.builder().build()));
	}

	private static MockHttpServletRequest request(String uri, String host, String login) {
		MockHttpServletRequest request = new MockHttpServletRequest("GET", uri);
		request.setRequestURI(uri);
		request.addHeader("Host", host);
		if (login != null) {
			request.addHeader(IdentityResolver.LOGIN_HEADER, login);
		}
		return request;
	}

	private static MockHttpServletResponse run(HostAndIdentityFilter filter, MockHttpServletRequest request,
			MockFilterChain chain) throws Exception {
		MockHttpServletResponse response = new MockHttpServletResponse();
		filter.doFilter(request, response, chain);
		return response;
	}

	@Test
	void admitsAllowedHostAndIdentity() throws Exception {
		MockFilterChain chain = new MockFilterChain();
		MockHttpServletRequest request = request("/api/tree", "notes.example.ts.net", "octocat@github");
		MockHttpServletResponse response = run(filter(Map.of()), request, chain);
		assertThat(response.getStatus()).isEqualTo(200);
		assertThat(chain.getRequest()).isNotNull();
		assertThat(request.getAttribute(Identity.ATTRIBUTE)).isInstanceOf(Identity.class);
	}

	@Test
	void foreignHostGets421() throws Exception {
		MockFilterChain chain = new MockFilterChain();
		MockHttpServletResponse response = run(filter(Map.of()), request("/api/tree", "evil.example", "octocat@github"),
				chain);
		assertThat(response.getStatus()).isEqualTo(421);
		assertThat(response.getContentType()).isEqualTo("application/problem+json");
		assertThat(response.getContentAsString()).contains("\"code\":\"unknown-host\"")
			.contains("\"type\":\"urn:notesapp:problem:unknown-host\"");
		assertThat(chain.getRequest()).isNull();
	}

	@Test
	void hostPortRules() {
		HostAndIdentityFilter filter = filter(Map.of());
		assertThat(filter.isAllowedHost("notes.example.ts.net:443")).isTrue();
		assertThat(filter.isAllowedHost("NOTES.example.ts.net")).isTrue();
		assertThat(filter.isAllowedHost("localhost:8080")).isTrue();
		assertThat(filter.isAllowedHost("localhost:9999")).isFalse();
		assertThat(filter.isAllowedHost("localhost")).isFalse();
		assertThat(filter.isAllowedHost("evil.example:8080")).isFalse();
		assertThat(filter.isAllowedHost(null)).isFalse();
	}

	@Test
	void missingLoginGets403UnlessDefaultsAreAllowed() throws Exception {
		MockHttpServletResponse refused = run(filter(Map.of()), request("/api/tree", "localhost:8080", null),
				new MockFilterChain());
		assertThat(refused.getStatus()).isEqualTo(403);
		assertThat(refused.getContentAsString()).contains("\"code\":\"identity-not-allowed\"");

		MockFilterChain chain = new MockFilterChain();
		MockHttpServletResponse admitted = run(filter(Map.of("notes.identity.allow-default", "true")),
				request("/api/tree", "localhost:8080", null), chain);
		assertThat(admitted.getStatus()).isEqualTo(200);
		assertThat(chain.getRequest()).isNotNull();
	}

	@Test
	void loginOutsideTheAllowlistGets403OutsideTheGuestSurface() throws Exception {
		for (String path : List.of("/api/tree", "/n/Note.md", "/settings", "/api/shares", "/sw.js",
				"/manifest.webmanifest", "/api/events", "/api/files/raw")) {
			MockFilterChain chain = new MockFilterChain();
			MockHttpServletResponse response = run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
					request(path, "localhost:8080", "stranger@github"), chain);
			assertThat(response.getStatus()).as(path).isEqualTo(403);
			assertThat(response.getContentAsString()).contains("\"code\":\"identity-not-allowed\"");
			assertThat(chain.getRequest()).as(path).isNull();
		}
	}

	@Test
	void guestsOpeningTheServerGoToTheirLandingPage() throws Exception {
		MockFilterChain chain = new MockFilterChain();
		MockHttpServletResponse response = run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
				request("/", "localhost:8080", "mom@example.com"), chain);
		assertThat(response.getStatus()).isEqualTo(303);
		assertThat(response.getHeader("Location")).isEqualTo("/s");
		assertThat(chain.getRequest()).isNull();
	}

	@ParameterizedTest
	@ValueSource(strings = { "/api/s", "/api/s/abcdefghijkl", "/api/s/abcdefghijkl/files", "/s", "/s/abcdefghijkl",
			"/v/work/s", "/v/work/s/abcdefghijkl", "/assets/index-abc.js", "/favicon.svg", "/theme-boot.js" })
	void guestsReachTheGuestSurface(String path) throws Exception {
		MockFilterChain chain = new MockFilterChain();
		MockHttpServletRequest request = request(path, "localhost:8080", "mom@example.com");
		MockHttpServletResponse response = run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
				request, chain);
		assertThat(response.getStatus()).isEqualTo(200);
		assertThat(chain.getRequest()).isNotNull();
		assertThat(((Identity) request.getAttribute(Identity.ATTRIBUTE)).login()).isEqualTo("mom@example.com");
	}

	@Test
	void theGuestSurfaceIsDecidedOnThePathSpringMatches() {
		assertThat(HostAndIdentityFilter.guestAccess("PUT", "/api/s/abcdefghijkl/files"))
			.isEqualTo(HostAndIdentityFilter.GuestAccess.ALLOW);
		assertThat(HostAndIdentityFilter.guestAccess("POST", "/s/abcdefghijkl"))
			.isEqualTo(HostAndIdentityFilter.GuestAccess.DENY);
		assertThat(HostAndIdentityFilter.guestAccess("POST", "/")).isEqualTo(HostAndIdentityFilter.GuestAccess.DENY);
		assertThat(HostAndIdentityFilter.guestAccess("DELETE", "/assets/x.js"))
			.isEqualTo(HostAndIdentityFilter.GuestAccess.DENY);
		for (String path : List.of("/api/s/../tree", "/api/s/x/../../tree", "/s/../api/tree", "/api/sx", "/api/shares",
				"/apis/s", "/v/work/n/x", "/v/Work/s", "/v/work/sx", "/x/s", "/n/s/x", "/assets", "/api/v/work/s",
				"/api/s/./x")) {
			assertThat(HostAndIdentityFilter.guestAccess("GET", path)).as(path)
				.isEqualTo(HostAndIdentityFilter.GuestAccess.DENY);
		}
	}

	@Test
	void escapedAndParameterizedPathsAreDecidedDecoded() throws Exception {
		// /api/%73hares decodes to /api/shares, which is not guest surface; /api/s;x=1/k is /api/s/k.
		MockFilterChain refusedChain = new MockFilterChain();
		MockHttpServletResponse refused = run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
				request("/api/%73hares", "localhost:8080", "mom@example.com"), refusedChain);
		assertThat(refused.getStatus()).isEqualTo(403);
		MockFilterChain refusedDots = new MockFilterChain();
		MockHttpServletResponse dots = run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
				request("/api/s/%2e%2e/tree", "localhost:8080", "mom@example.com"), refusedDots);
		assertThat(dots.getStatus()).isEqualTo(403);
		MockFilterChain chain = new MockFilterChain();
		MockHttpServletResponse admitted = run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
				request("/api/s;x=1/abcdefghijkl", "localhost:8080", "mom@example.com"), chain);
		assertThat(admitted.getStatus()).isEqualTo(200);
	}

	@Test
	void ownersAndAnEmptyListAreUnchanged() throws Exception {
		MockFilterChain owner = new MockFilterChain();
		run(filter(Map.of("notes.identity.allowed-logins", "octocat@github")),
				request("/api/tree", "localhost:8080", "OctoCat@GitHub"), owner);
		assertThat(owner.getRequest()).isNotNull();
		MockFilterChain anyone = new MockFilterChain();
		run(filter(Map.of()), request("/api/tree", "localhost:8080", "anyone@example.com"), anyone);
		assertThat(anyone.getRequest()).isNotNull();
	}

	@ParameterizedTest
	@ValueSource(strings = { "/livez", "/readyz", "/actuator/health", "/actuator/health/liveness" })
	void healthPathsAreExemptFromBothChecks(String path) throws Exception {
		MockFilterChain chain = new MockFilterChain();
		MockHttpServletResponse response = run(filter(Map.of()), request(path, "127.0.0.1:8080", null), chain);
		assertThat(response.getStatus()).isEqualTo(200);
		assertThat(chain.getRequest()).isNotNull();
	}

}
