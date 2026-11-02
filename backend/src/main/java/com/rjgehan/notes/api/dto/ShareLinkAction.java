package com.rjgehan.notes.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** {@code UpdateShareRequest.link} (API.md §42.3). */
public enum ShareLinkAction {

	/** The current link stays as it is (and no link stays no link). */
	@JsonProperty("keep") KEEP,

	/** A new token: the old link stops working, the new one is in the answer. */
	@JsonProperty("new") NEW,

	/** The link is removed. */
	@JsonProperty("none") NONE

}
