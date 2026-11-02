package com.rjgehan.notes.api.dto;

import java.util.List;

import org.jspecify.annotations.Nullable;

/**
 * {@code GET /api/shares} (API.md §42.1). {@code available} is false while the server has no owner list
 * ({@code reason: "no-owner-list"}): every tailnet login is then an owner, so nothing can be shared.
 */
public record SharesResponse(boolean available, @Nullable String reason, List<ShareInfo> shares) {
}
