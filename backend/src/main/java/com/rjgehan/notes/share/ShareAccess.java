package com.rjgehan.notes.share;

import java.io.IOException;
import java.util.Locale;
import java.util.Map;

import com.rjgehan.notes.api.dto.ShareKind;
import com.rjgehan.notes.api.dto.ShareMode;
import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.identity.IdentityResolver;
import com.rjgehan.notes.index.FileRecord;
import com.rjgehan.notes.index.VaultIndex;
import com.rjgehan.notes.vault.PathNames;
import com.rjgehan.notes.vault.VaultPaths;
import org.jspecify.annotations.Nullable;

import org.springframework.stereotype.Component;

/**
 * What one guest request may do (DESIGN §5.40): the key in its path names a share (an id, for its recipients; a link
 * token, for anyone who has it), and every path it names must be in that share's scope. Deny by default: anything not
 * shown to be allowed answers {@code 404 share-not-found}, {@code 403 outside-share} or {@code 403 share-read-only},
 * and the refusals that could be probing count against the guest's login ({@link ShareRateLimiter}).
 */
@Component
public class ShareAccess {

	/** A request's right to one share: the share as it is now, who asks, and how they hold it. */
	public record Grant(Share share, Identity identity, boolean owner, @Nullable String linkHash) {

		public boolean editable() {
			return this.share.mode() == ShareMode.EDIT;
		}

	}

	private final ShareService shares;

	private final ShareRateLimiter limiter;

	private final IdentityResolver identities;

	private final VaultPaths paths;

	private final VaultIndex index;

	public ShareAccess(ShareService shares, ShareRateLimiter limiter, IdentityResolver identities, VaultPaths paths,
			VaultIndex index) {
		this.shares = shares;
		this.limiter = limiter;
		this.identities = identities;
		this.paths = paths;
		this.index = index;
	}

	/** Throws {@code 429 too-many-attempts} while a guest's login is locked out; owners pass. */
	public void checkRate(Identity identity) {
		if (!this.identities.isOwner(identity)) {
			this.limiter.check(identity.login());
		}
	}

	/**
	 * The share {@code key} opens for {@code identity}, or {@code 404 share-not-found}: for an unknown key, a key of
	 * any other shape, an expired share, and an id used by someone who is not one of its recipients alike.
	 */
	public Grant open(String key, Identity identity) throws IOException {
		boolean owner = this.identities.isOwner(identity);
		if (!owner) {
			this.limiter.check(identity.login());
		}
		Share share = null;
		String linkHash = null;
		try {
			if (ShareTokens.isId(key)) {
				Share candidate = this.shares.byId(key);
				if (candidate != null && (owner || candidate.names(identity.login()))) {
					share = candidate;
				}
			}
			else if (ShareTokens.isToken(key)) {
				linkHash = ShareTokens.hash(key);
				share = this.shares.byLinkHash(linkHash);
			}
		}
		catch (NotesException ex) {
			// A shares.json that cannot be read opens nothing; its owner sees why in Settings.
			if (ex.code() != ErrorCode.MALFORMED_FILE) {
				throw ex;
			}
			share = null;
		}
		if (share == null || share.expired(this.shares.now())) {
			throw refuse(identity, owner, new NotesException(ErrorCode.SHARE_NOT_FOUND,
					"This share does not exist, has ended, or is not for this Tailscale login"));
		}
		return new Grant(share, identity, owner, linkHash);
	}

	/**
	 * True while the holder of a grant made earlier still has it: the share exists and has not expired, and its link
	 * is the same one or its recipients still include the login. Asked by guests' event streams.
	 */
	public boolean stillValid(Grant grant) {
		Share current;
		try {
			current = this.shares.byId(grant.share().id());
		}
		catch (IOException | RuntimeException ex) {
			return false;
		}
		if (current == null || current.expired(this.shares.now())) {
			return false;
		}
		if (grant.linkHash() != null) {
			return current.link() != null && ShareTokens.sameHash(current.link().hash(), grant.linkHash());
		}
		return grant.owner() || current.names(grant.identity().login());
	}

	/** The share as it is now (it may have moved since the grant was made), or null once it is gone. */
	public @Nullable Share current(Grant grant) {
		try {
			return this.shares.byId(grant.share().id());
		}
		catch (IOException | RuntimeException ex) {
			return null;
		}
	}

	/** A text file the grant may read: in the share's scope. Returns the normalized path. */
	public String readable(Grant grant, @Nullable String raw) {
		String path = normalized(grant, raw);
		if (!grant.share().contains(path)) {
			throw outside(grant, path);
		}
		return path;
	}

	/** A file the grant may fetch raw: in the scope, or media its notes embed (DESIGN §5.40). */
	public String raw(Grant grant, @Nullable String raw) {
		String path = normalized(grant, raw);
		if (!this.shares.rawAllowed(grant.share(), path)) {
			throw outside(grant, path);
		}
		return path;
	}

	/**
	 * A note the grant may save: an edit share, in its scope, a Markdown note; for a note share, one that exists (a
	 * save never recreates a deleted shared note).
	 */
	public String writable(Grant grant, @Nullable String raw) {
		String path = normalized(grant, raw);
		if (!grant.share().contains(path)) {
			throw outside(grant, path);
		}
		requireEditableNote(grant, path);
		if (grant.share().kind() == ShareKind.NOTE) {
			FileRecord record = this.index.file(path);
			if (record == null) {
				throw NotesException.notFound(path);
			}
		}
		return path;
	}

	/**
	 * A new note the grant may create: an edit share of a folder, inside it, a Markdown note. The folders a new file's
	 * parents resolve to are matched without regard to case, so the path is also checked where it would land: with the
	 * shared folder gone, a private folder spelled in another case must not take the guest's note.
	 */
	public String creatable(Grant grant, @Nullable String raw) {
		String path = normalized(grant, raw);
		if (grant.share().kind() != ShareKind.FOLDER || !grant.share().contains(path)) {
			throw outside(grant, path);
		}
		requireEditableNote(grant, path);
		String target;
		try {
			target = this.paths.resolve(path, VaultPaths.Mode.NEW).nfc();
		}
		catch (NotesException ex) {
			throw refuse(grant.identity(), grant.owner(), ex);
		}
		if (!grant.share().contains(target)) {
			throw outside(grant, path);
		}
		return path;
	}

	/**
	 * Refuses text that adds embeds reaching outside the share. Not counted toward the rate limit: the answer is the
	 * same whether the file exists or not, and autosave sends the text again after every pause while the guest still
	 * has the embed.
	 */
	public void checkEmbeds(Grant grant, String path, String content) {
		this.shares.checkGuestEmbeds(grant.share(), path, content);
	}

	private void requireEditableNote(Grant grant, String path) {
		if (!grant.editable()) {
			throw new NotesException(ErrorCode.SHARE_READ_ONLY, "This share is view only");
		}
		String lower = path.toLowerCase(Locale.ROOT);
		if (!PathNames.isMarkdown(path) || lower.endsWith(".excalidraw.md")) {
			throw new NotesException(ErrorCode.SHARE_READ_ONLY, "Only notes can be edited in a share",
					Map.of("path", path));
		}
	}

	/** The vault's path rules; a path they refuse counts like a refused one. */
	private String normalized(Grant grant, @Nullable String raw) {
		if (raw == null) {
			throw NotesException.badRequest("path is required");
		}
		try {
			return this.paths.normalize(raw);
		}
		catch (NotesException ex) {
			throw refuse(grant.identity(), grant.owner(), ex);
		}
	}

	private NotesException outside(Grant grant, String path) {
		return refuse(grant.identity(), grant.owner(), new NotesException(ErrorCode.OUTSIDE_SHARE,
				"That file is not part of this share", Map.of("path", path)));
	}

	private NotesException refuse(Identity identity, boolean owner, NotesException ex) {
		if (!owner) {
			this.limiter.fail(identity.login());
		}
		return ex;
	}

}
