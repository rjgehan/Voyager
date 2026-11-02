package com.rjgehan.notes.api.dto;

import java.util.List;

/** {@code GET /api/s} (API.md §42.5): who is asking, and the shares naming that login in every vault. */
public record GuestLandingResponse(String login, String name, List<GuestShareSummary> shares) {
}
