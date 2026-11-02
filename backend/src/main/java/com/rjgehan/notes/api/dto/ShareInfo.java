package com.rjgehan.notes.api.dto;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

/** One share as the owner sees it (API.md §42.1). The link's token is never part of it. */
public record ShareInfo(String id, String path, ShareKind kind, ShareMode mode, List<String> recipients,
		boolean hasLink, @Nullable Instant linkCreatedAt, @Nullable Instant expiresAt, Instant createdAt,
		String createdBy, ShareState state, String url) {
}
