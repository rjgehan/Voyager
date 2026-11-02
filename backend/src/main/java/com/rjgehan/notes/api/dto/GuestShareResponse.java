package com.rjgehan.notes.api.dto;

import java.time.Instant;
import java.util.List;

import org.jspecify.annotations.Nullable;

/**
 * {@code GET /api/s/{key}} (API.md §42.6): what a guest may see of one share. {@code files} are the shared files,
 * {@code embedded} the media outside the share that its notes embed; {@code eventId} is where the guest's event stream
 * resumes.
 */
public record GuestShareResponse(String id, ShareKind kind, String path, String title, ShareMode mode,
		String sharedBy, @Nullable Instant expiresAt, String eventId, List<FolderEntry> folders, List<FileEntry> files,
		List<FileEntry> embedded, String login) {
}
