package com.rjgehan.notes.api.dto;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

/** {@code PUT /api/shares/{id}} (API.md §42.3): the share's new settings, all of them. */
public record UpdateShareRequest(@Nullable ShareMode mode, @Nullable List<String> recipients,
		@Nullable ShareLinkAction link, @Nullable Instant expiresAt) {
}
