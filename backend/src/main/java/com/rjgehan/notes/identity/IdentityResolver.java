package com.rjgehan.notes.identity;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import com.rjgehan.notes.config.NotesProperties;
import org.jspecify.annotations.Nullable;

import org.springframework.stereotype.Component;

/**
 * Reads the {@code Tailscale-User-*} headers set by {@code tailscale serve} and applies the identity allowlist
 * (DESIGN §5.13). Without a login, the configured default identity is used only when {@code allow-default} is on (the
 * dev profile). The allowlist names the <em>owners</em>; any other login is a guest, which reaches only what is
 * shared with it (DESIGN §5.40).
 */
@Component
public class IdentityResolver {

	public static final String LOGIN_HEADER = "Tailscale-User-Login";

	public static final String NAME_HEADER = "Tailscale-User-Name";

	public static final String PICTURE_HEADER = "Tailscale-User-Profile-Pic";

	private final NotesProperties.Identity properties;

	private final List<String> owners;

	public IdentityResolver(NotesProperties properties) {
		this.properties = properties.identity();
		this.owners = this.properties.allowedLogins().stream().map(String::strip).toList();
	}

	/** The admitted owner identity, or null when the request is not an owner's (DESIGN §5.13). */
	public @Nullable Identity resolve(HttpServletRequest request) {
		return resolve(request.getHeader(LOGIN_HEADER), request.getHeader(NAME_HEADER),
				request.getHeader(PICTURE_HEADER));
	}

	/** The owner identity of these header values, or null for no identity or a guest's. */
	public @Nullable Identity resolve(@Nullable String login, @Nullable String name, @Nullable String picture) {
		Identity identity = resolveAny(login, name, picture);
		return (identity != null && isOwner(identity)) ? identity : null;
	}

	/** The identity of any Tailscale login (an owner's or a guest's), or null when the request has none. */
	public @Nullable Identity resolveAny(HttpServletRequest request) {
		return resolveAny(request.getHeader(LOGIN_HEADER), request.getHeader(NAME_HEADER),
				request.getHeader(PICTURE_HEADER));
	}

	public @Nullable Identity resolveAny(@Nullable String login, @Nullable String name, @Nullable String picture) {
		String trimmedLogin = (login != null) ? login.strip() : "";
		if (trimmedLogin.isEmpty()) {
			if (!this.properties.allowDefault()) {
				return null;
			}
			return new Identity(this.properties.defaultLogin(), this.properties.defaultName(), null,
					Identity.Source.DEFAULT);
		}
		String decodedName = (name != null) ? Rfc2047.decode(name).strip() : "";
		String pictureUrl = (picture != null && !picture.isBlank()) ? picture.strip() : null;
		return new Identity(trimmedLogin, decodedName.isEmpty() ? trimmedLogin : decodedName, pictureUrl,
				Identity.Source.TAILSCALE);
	}

	/**
	 * True for an owner: the dev profile's default identity, any login while the allowlist is empty, or a login on it
	 * (compared ignoring case).
	 */
	public boolean isOwner(Identity identity) {
		if (identity.source() == Identity.Source.DEFAULT || this.owners.isEmpty()) {
			return true;
		}
		return this.owners.stream().anyMatch((entry) -> entry.equalsIgnoreCase(identity.login()));
	}

	/** True when the allowlist names the owners; without one every tailnet login is an owner and nobody a guest. */
	public boolean hasOwnerList() {
		return !this.owners.isEmpty();
	}

}
