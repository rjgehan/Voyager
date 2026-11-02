package com.rjgehan.notes.api.dto;

import org.jspecify.annotations.Nullable;

/** A share naming the guest, for the landing page (API.md §42.5). {@code vault} is null for the default vault. */
public record GuestShareSummary(@Nullable String vault, String id, ShareKind kind, String title, ShareMode mode,
		String sharedBy, String url) {
}
