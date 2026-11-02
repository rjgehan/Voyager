package com.rjgehan.notes.api;

import java.io.IOException;

import com.rjgehan.notes.api.dto.CreateShareRequest;
import com.rjgehan.notes.api.dto.ShareResult;
import com.rjgehan.notes.api.dto.SharesResponse;
import com.rjgehan.notes.api.dto.UpdateShareRequest;
import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.config.ApiGuardInterceptor;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.identity.IdentityResolver;
import com.rjgehan.notes.share.ShareService;
import org.jspecify.annotations.Nullable;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * The owner's shares (API.md §42.1 to §42.4). Owners only: admission already refuses guests everywhere outside the
 * guest surface (DESIGN §5.40); each method checks again.
 */
@RestController
public class ShareController {

	private final ShareService shares;

	private final IdentityResolver identities;

	public ShareController(ShareService shares, IdentityResolver identities) {
		this.shares = shares;
		this.identities = identities;
	}

	@GetMapping("/api/shares")
	SharesResponse list(Identity identity) throws IOException {
		requireOwner(identity);
		return this.shares.list();
	}

	@PostMapping("/api/shares")
	ResponseEntity<ShareResult> create(@RequestBody CreateShareRequest request, Identity identity,
			@RequestHeader(name = ApiGuardInterceptor.CLIENT_ID_HEADER, required = false) @Nullable String origin)
			throws IOException {
		requireOwner(identity);
		return ResponseEntity.status(HttpStatus.CREATED).body(this.shares.create(request, identity, origin));
	}

	@PutMapping("/api/shares/{id}")
	ShareResult update(@PathVariable String id, @RequestBody UpdateShareRequest request, Identity identity,
			@RequestHeader(name = ApiGuardInterceptor.CLIENT_ID_HEADER, required = false) @Nullable String origin)
			throws IOException {
		requireOwner(identity);
		return this.shares.update(id, request, identity, origin);
	}

	@DeleteMapping("/api/shares/{id}")
	ResponseEntity<Void> revoke(@PathVariable String id, Identity identity,
			@RequestHeader(name = ApiGuardInterceptor.CLIENT_ID_HEADER, required = false) @Nullable String origin)
			throws IOException {
		requireOwner(identity);
		this.shares.revoke(id, identity, origin);
		return ResponseEntity.noContent().build();
	}

	private void requireOwner(Identity identity) {
		if (!this.identities.isOwner(identity)) {
			throw new NotesException(ErrorCode.IDENTITY_NOT_ALLOWED, "This identity may not use NotesApp");
		}
	}

}
