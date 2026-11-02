package com.rjgehan.notes.api.dto;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

/** {@code POST /api/shares} (API.md §42.2). */
public record CreateShareRequest(@Nullable String path, @Nullable ShareMode mode, @Nullable List<String> recipients,
		@Nullable Boolean link, @Nullable Instant expiresAt) {
}
