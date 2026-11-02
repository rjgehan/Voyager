package com.rjgehan.notes.events;

import org.jspecify.annotations.Nullable;

/**
 * The shares changed ({@code shares.changed}, DESIGN §5.40): one was made, changed or revoked, or the server re-keyed
 * them after a move ({@code origin} null). Owners' tabs refetch {@code GET /api/shares}; guests never receive it.
 */
public record SharesChangedEvent(@Nullable String origin) implements VaultEvent {

	@Override
	public String eventName() {
		return "shares.changed";
	}

	@Override
	public @Nullable String echoOrigin() {
		return this.origin;
	}

}
