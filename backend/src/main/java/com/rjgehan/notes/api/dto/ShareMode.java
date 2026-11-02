package com.rjgehan.notes.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/** {@code read}: view only; {@code edit}: the shared notes can be edited (API.md §42). */
public enum ShareMode {

	@JsonProperty("read") READ,
	@JsonProperty("edit") EDIT

}
