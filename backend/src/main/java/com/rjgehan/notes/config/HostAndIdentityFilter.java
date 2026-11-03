package com.rjgehan.notes.config;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.api.error.Problems;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.identity.IdentityResolver;
import com.rjgehan.notes.vaults.ServerWide;
import org.jspecify.annotations.Nullable;
import org.slf4j.MDC;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Admission (DESIGN §5.13): the Host allowlist ({@code 421 unknown-host}, which blocks DNS rebinding) and the identity
 * allowlist ({@code 403 identity-not-allowed}) for every request except the health endpoints. The allowlist names the
 * owners; any other Tailscale login is a guest and continues only to the guest surface of DESIGN §5.40 (the guest API
 * {@code /api/s/**}, the guest page and its static files), decided on the path Spring MVC matches. The admitted identity
 * is stored as a request attribute, and the client id and a short request id are put in the logging MDC.
 */
@Component
@ServerWide
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class HostAndIdentityFilter extends OncePerRequestFilter {

	/** What a guest may request: the guest surface, the root's redirect to it, or nothing else. */
	enum GuestAccess {

		ALLOW, REDIRECT, DENY

	}

	/** The guest page of an extra vault: {@code /v/<name>/s} and below. */
	private static final Pattern VAULT_GUEST_PAGE = Pattern.compile("/v/[a-z0-9-]{1,32}/s(/.*)?");

	/** The guest page's files at the root of the static folder (everything else it loads is under {@code /assets/}). */
	static final Set<String> GUEST_STATIC_FILES = Set.of("/favicon.svg", "/theme-boot.js", "/apple-touch-icon.png",
			"/robots.txt");

	/** Where a guest who opens the server's plain address goes: the landing page of the guest page. */
	static final String GUEST_LANDING = "/s";

	private final List<String> allowedHosts;

	private final IdentityResolver identityResolver;

	private final Problems problems;

	public HostAndIdentityFilter(NotesProperties properties, IdentityResolver identityResolver, Problems problems) {
		this.allowedHosts = properties.allowedHosts().stream().map((h) -> h.strip().toLowerCase(Locale.ROOT)).toList();
		this.identityResolver = identityResolver;
		this.problems = problems;
	}

	@Override
	protected boolean shouldNotFilter(HttpServletRequest request) {
		String path = RequestPaths.of(request);
		return isHealthPath(path) && !RequestPaths.hasDotSegment(path);
	}

	static boolean isHealthPath(String uri) {
		return uri.equals("/livez") || uri.equals("/readyz") || uri.equals("/actuator/health")
				|| uri.startsWith("/actuator/health/");
	}

	@Override
	protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
			throws ServletException, IOException {
		if (!isAllowedHost(request.getHeader("Host"))) {
			this.problems.write(request, response,
					new NotesException(ErrorCode.UNKNOWN_HOST, "This server does not answer to that host name"));
			return;
		}
		Identity identity = this.identityResolver.resolveAny(request);
		if (identity == null) {
			this.problems.write(request, response,
					new NotesException(ErrorCode.IDENTITY_NOT_ALLOWED, "This identity may not use Voyager"));
			return;
		}
		if (!this.identityResolver.isOwner(identity)) {
			GuestAccess access = guestAccess(request.getMethod(), RequestPaths.of(request));
			if (access == GuestAccess.REDIRECT) {
				response.setStatus(HttpServletResponse.SC_SEE_OTHER);
				response.setHeader("Location", request.getContextPath() + GUEST_LANDING);
				return;
			}
			if (access != GuestAccess.ALLOW) {
				this.problems.write(request, response,
						new NotesException(ErrorCode.IDENTITY_NOT_ALLOWED, "This identity may not use Voyager"));
				return;
			}
		}
		request.setAttribute(Identity.ATTRIBUTE, identity);
		String clientId = request.getHeader("X-Client-Id");
		MDC.put("client", (clientId != null) ? clientId.substring(0, Math.min(8, clientId.length())) : "-");
		MDC.put("request", Problems.newIncidentId().substring(0, 6));
		try {
			chain.doFilter(request, response);
		}
		finally {
			MDC.remove("client");
			MDC.remove("request");
		}
	}

	/**
	 * What a guest (a login outside the allowlist) may request (DESIGN §5.40), on the path Spring MVC matches: any method
	 * on the guest API ({@code /api/s} and below, which an extra vault's {@code /api/v/<name>/s/...} has already been
	 * routed to), and {@code GET}/{@code HEAD} of the guest page ({@code /s/**}, {@code /v/<name>/s/**}) and its static
	 * files. {@code /} sends a guest to the landing page; a path with a dot segment is never guest surface.
	 */
	static GuestAccess guestAccess(String method, String path) {
		if (RequestPaths.hasDotSegment(path)) {
			return GuestAccess.DENY;
		}
		if (path.equals("/api/s") || path.startsWith("/api/s/")) {
			return GuestAccess.ALLOW;
		}
		if (!"GET".equals(method) && !"HEAD".equals(method)) {
			return GuestAccess.DENY;
		}
		if (path.equals("/")) {
			return GuestAccess.REDIRECT;
		}
		if (path.equals(GUEST_LANDING) || path.startsWith(GUEST_LANDING + "/") || VAULT_GUEST_PAGE.matcher(path).matches()
				|| path.startsWith("/assets/") || GUEST_STATIC_FILES.contains(path)) {
			return GuestAccess.ALLOW;
		}
		return GuestAccess.DENY;
	}

	/**
	 * Entries are {@code host} or {@code host:port}, compared case-insensitively; an entry without a port matches any
	 * port. An empty allowlist (only possible in the dev profile) admits every host.
	 */
	boolean isAllowedHost(@Nullable String hostHeader) {
		if (this.allowedHosts.isEmpty()) {
			return true;
		}
		if (hostHeader == null || hostHeader.isBlank()) {
			return false;
		}
		String host = hostHeader.strip().toLowerCase(Locale.ROOT);
		String hostOnly = hostWithoutPort(host);
		for (String entry : this.allowedHosts) {
			boolean entryHasPort = !hostWithoutPort(entry).equals(entry);
			if (entryHasPort ? entry.equals(host) : entry.equals(hostOnly)) {
				return true;
			}
		}
		return false;
	}

	static String hostWithoutPort(String authority) {
		if (authority.startsWith("[")) {
			int end = authority.indexOf(']');
			return (end > 0) ? authority.substring(0, end + 1) : authority;
		}
		int colon = authority.lastIndexOf(':');
		return (colon >= 0) ? authority.substring(0, colon) : authority;
	}

}
