package com.rjgehan.notes.api.dto;

import org.jspecify.annotations.Nullable;

/**
 * The answer to creating or changing a share (API.md §42.2, §42.3). {@code link} is the new capability link's address
 * ({@code /s/<token>}), only in the answer that made it: the server keeps only the token's hash.
 */
public record ShareResult(ShareInfo share, @Nullable String link) {
}
