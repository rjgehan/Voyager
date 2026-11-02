package com.rjgehan.notes.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** What a share gives access to (API.md §42): one Markdown note, or a folder with everything under it. */
public enum ShareKind {

	@JsonProperty("note") NOTE,
	@JsonProperty("folder") FOLDER

}
