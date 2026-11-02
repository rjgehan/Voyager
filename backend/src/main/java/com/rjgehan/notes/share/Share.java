package com.rjgehan.notes.share;

import java.time.Instant;
import java.util.List;

import com.rjgehan.notes.api.dto.ShareKind;
import com.rjgehan.notes.api.dto.ShareMode;
import org.jspecify.annotations.Nullable;

/**
 * One share as {@code .notesapp/shares.json} stores it (DESIGN §5.40): a note or folder ({@code path}, NFC), what
 * guests may do there, who may use it ({@code recipients}, Tailscale logins, and/or a capability link of which only the
 * token's SHA-256 is kept), and when it ends.
 */
public record Share(String id, String path, ShareKind kind, ShareMode mode, List<String> recipients,
		@Nullable Link link, @Nullable Instant expiresAt, Instant createdAt, String createdBy, String createdByName) {

	/** A capability link: the hex SHA-256 of its token, never the token. */
	public record Link(String hash, Instant createdAt) {
	}

	public Share {
		recipients = List.copyOf(recipients);
	}

	/** True once {@code expiresAt} has passed. */
	public boolean expired(Instant now) {
		return this.expiresAt != null && !now.isBefore(this.expiresAt);
	}

	/** True when {@code login} is one of the recipients (compared ignoring case, as the allowlist is). */
	public boolean names(String login) {
		return this.recipients.stream().anyMatch((recipient) -> recipient.equalsIgnoreCase(login));
	}

	/** True when the share's scope contains {@code path} (an NFC vault path). */
	public boolean contains(String path) {
		return ShareScope.contains(this.kind, this.path, path);
	}

	public Share withPath(String newPath) {
		return new Share(this.id, newPath, this.kind, this.mode, this.recipients, this.link, this.expiresAt,
				this.createdAt, this.createdBy, this.createdByName);
	}

}
