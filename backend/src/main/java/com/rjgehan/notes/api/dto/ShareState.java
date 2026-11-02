package com.rjgehan.notes.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** {@code ShareInfo.state} (API.md §42.1). */
public enum ShareState {

	/** Guests can use it. */
	@JsonProperty("active") ACTIVE,

	/** Past its {@code expiresAt}: guests get {@code 404 share-not-found} until it is extended. */
	@JsonProperty("expired") EXPIRED,

	/** The note or folder is gone (deleted, or moved outside the app); restoring it brings the share back. */
	@JsonProperty("missing") MISSING

}
