package com.rjgehan.notes.share;

import java.io.IOException;
import java.text.Normalizer;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

import com.rjgehan.notes.api.dto.CreateShareRequest;
import com.rjgehan.notes.api.dto.EntryType;
import com.rjgehan.notes.api.dto.FileEntry;
import com.rjgehan.notes.api.dto.FileKind;
import com.rjgehan.notes.api.dto.FolderEntry;
import com.rjgehan.notes.api.dto.GuestShareResponse;
import com.rjgehan.notes.api.dto.GuestShareSummary;
import com.rjgehan.notes.api.dto.ShareInfo;
import com.rjgehan.notes.api.dto.ShareKind;
import com.rjgehan.notes.api.dto.ShareLinkAction;
import com.rjgehan.notes.api.dto.ShareMode;
import com.rjgehan.notes.api.dto.ShareResult;
import com.rjgehan.notes.api.dto.ShareState;
import com.rjgehan.notes.api.dto.SharesResponse;
import com.rjgehan.notes.api.dto.UpdateShareRequest;
import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.config.NotesProperties;
import com.rjgehan.notes.events.EventHub;
import com.rjgehan.notes.events.SharesChangedEvent;
import com.rjgehan.notes.history.Author;
import com.rjgehan.notes.history.CommitBatcher;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.identity.IdentityResolver;
import com.rjgehan.notes.index.FileRecord;
import com.rjgehan.notes.index.LinkGraph;
import com.rjgehan.notes.index.LinkOcc;
import com.rjgehan.notes.index.MarkdownScanner;
import com.rjgehan.notes.index.NoteRecord;
import com.rjgehan.notes.index.VaultIndex;
import com.rjgehan.notes.vault.PathNames;
import com.rjgehan.notes.vault.VaultPaths;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.stereotype.Service;

/**
 * Sharing with family (ROADMAP item 43, DESIGN §5.40): the owner's operations on {@code .notesapp/shares.json}, the
 * lookups guests' keys resolve through, the scope's embedded media, the check of the embeds a guest adds, and the
 * shares following moves. One per vault.
 */
@Service
public class ShareService {

	private static final Logger logger = LoggerFactory.getLogger(ShareService.class);

	public static final int MAX_SHARES = 200;

	public static final int MAX_RECIPIENTS = 20;

	/** How long media a share embedded may be embedded again by its guests after the note stopped embedding it. */
	static final Duration EMBED_GRACE = Duration.ofHours(24);

	private static final int MAX_REMEMBERED = 1000;

	private static final Set<FileKind> MEDIA = Set.of(FileKind.IMAGE, FileKind.AUDIO, FileKind.VIDEO, FileKind.PDF);

	private record EmbedCache(String path, long generation, Set<String> media) {
	}

	private final ShareStore store;

	private final VaultIndex index;

	private final IdentityResolver identities;

	private final EventHub hub;

	private final CommitBatcher batcher;

	private final Clock clock;

	private final String prefix;

	private final ReentrantLock lock = new ReentrantLock();

	private final Map<String, EmbedCache> embedCache = new ConcurrentHashMap<>();

	/** Per share: outside media its notes embedded, and when that was last seen (the 24-hour grace). */
	private final Map<String, Map<String, Instant>> rememberedMedia = new ConcurrentHashMap<>();

	public ShareService(ShareStore store, VaultIndex index, IdentityResolver identities, EventHub hub,
			CommitBatcher batcher, Clock clock, NotesProperties properties) {
		this.store = store;
		this.index = index;
		this.identities = identities;
		this.hub = hub;
		this.batcher = batcher;
		this.clock = clock;
		this.prefix = properties.vaults().isDefault() ? "" : "/v/" + properties.vaults().currentName();
	}

	// ---------------------------------------------------------------- owners

	/** {@code GET /api/shares}: newest first. */
	public SharesResponse list() throws IOException {
		boolean available = this.identities.hasOwnerList();
		List<ShareInfo> shares = this.store.read()
			.stream()
			.sorted(Comparator.comparing(Share::createdAt).reversed())
			.map(this::info)
			.toList();
		return new SharesResponse(available, available ? null : "no-owner-list", shares);
	}

	/** {@code POST /api/shares}. */
	public ShareResult create(CreateShareRequest request, Identity owner, @Nullable String origin) throws IOException {
		requireAvailable();
		if (request.path() == null || request.path().isBlank()) {
			throw NotesException.badRequest("path is required");
		}
		if (request.mode() == null) {
			throw NotesException.badRequest("mode must be read or edit");
		}
		String path = checkedPath(request.path());
		ShareKind kind = kindOf(path);
		List<String> recipients = recipients(request.recipients());
		boolean link = Boolean.TRUE.equals(request.link());
		if (recipients.isEmpty() && !link) {
			throw NotesException.badRequest("Name at least one person or make a link");
		}
		Instant now = this.clock.instant();
		if (request.expiresAt() != null && !request.expiresAt().isAfter(now)) {
			throw NotesException.badRequest("expiresAt must be in the future");
		}
		String token = link ? ShareTokens.newToken() : null;
		try (CommitBatcher.Operation operation = this.batcher.beginOperation()) {
			lock();
			try {
				List<Share> shares = this.store.read();
				if (shares.size() >= MAX_SHARES) {
					throw NotesException.badRequest("At most " + MAX_SHARES + " shares; revoke one first");
				}
				Set<String> ids = new HashSet<>();
				shares.forEach((s) -> ids.add(s.id()));
				String id = ShareTokens.newId();
				while (ids.contains(id)) {
					id = ShareTokens.newId();
				}
				Share share = new Share(id, path, kind, request.mode(), recipients,
						(token != null) ? new Share.Link(ShareTokens.hash(token), now) : null, request.expiresAt(), now,
						owner.login(), owner.name());
				List<Share> next = new ArrayList<>(shares);
				next.add(share);
				this.store.write(next, Author.of(owner));
				logger.info("SHARE {} {} {} {} recipients={} link={} user={}", id, kind, path, request.mode(),
						recipients.size(), token != null, owner.login());
				this.hub.publish(new SharesChangedEvent(origin));
				return new ShareResult(info(share), (token != null) ? this.prefix + "/s/" + token : null);
			}
			finally {
				this.lock.unlock();
			}
		}
	}

	/** {@code PUT /api/shares/{id}}: every setting at once; {@code link: new} answers the new link once. */
	public ShareResult update(String id, UpdateShareRequest request, Identity owner, @Nullable String origin)
			throws IOException {
		if (request.mode() == null) {
			throw NotesException.badRequest("mode must be read or edit");
		}
		List<String> recipients = recipients(request.recipients());
		ShareLinkAction action = (request.link() != null) ? request.link() : ShareLinkAction.KEEP;
		Instant now = this.clock.instant();
		try (CommitBatcher.Operation operation = this.batcher.beginOperation()) {
			lock();
			try {
				List<Share> shares = this.store.read();
				Share current = find(shares, id);
				if (current == null) {
					throw new NotesException(ErrorCode.NOT_FOUND, "No such share", Map.of("id", id));
				}
				if (request.expiresAt() != null && !request.expiresAt().isAfter(now)
						&& !request.expiresAt().equals(current.expiresAt())) {
					throw NotesException.badRequest("expiresAt must be in the future");
				}
				String token = null;
				Share.Link link = current.link();
				if (action == ShareLinkAction.NEW) {
					requireAvailable();
					token = ShareTokens.newToken();
					link = new Share.Link(ShareTokens.hash(token), now);
				}
				else if (action == ShareLinkAction.NONE) {
					link = null;
				}
				if (recipients.isEmpty() && link == null) {
					throw NotesException.badRequest("Name at least one person or keep a link; or revoke the share");
				}
				Share updated = new Share(current.id(), current.path(), current.kind(), request.mode(), recipients, link,
						request.expiresAt(), current.createdAt(), current.createdBy(), current.createdByName());
				List<Share> next = shares.stream().map((s) -> s.id().equals(id) ? updated : s).toList();
				this.store.write(next, Author.of(owner));
				logger.info("SHARE-UPDATE {} {} recipients={} link={} user={}", id, request.mode(), recipients.size(),
						action, owner.login());
				this.hub.publish(new SharesChangedEvent(origin));
				this.hub.recheckFilters();
				return new ShareResult(info(updated), (token != null) ? this.prefix + "/s/" + token : null);
			}
			finally {
				this.lock.unlock();
			}
		}
	}

	/** {@code DELETE /api/shares/{id}}: the share is gone, and its guests' streams end. */
	public void revoke(String id, Identity owner, @Nullable String origin) throws IOException {
		try (CommitBatcher.Operation operation = this.batcher.beginOperation()) {
			lock();
			try {
				List<Share> shares = this.store.read();
				if (find(shares, id) == null) {
					throw new NotesException(ErrorCode.NOT_FOUND, "No such share", Map.of("id", id));
				}
				this.store.write(shares.stream().filter((s) -> !s.id().equals(id)).toList(), Author.of(owner));
				this.embedCache.remove(id);
				this.rememberedMedia.remove(id);
				logger.info("SHARE-REVOKE {} user={}", id, owner.login());
				this.hub.publish(new SharesChangedEvent(origin));
				this.hub.recheckFilters();
			}
			finally {
				this.lock.unlock();
			}
		}
	}

	/**
	 * After a move or rename through the app (the caller holds the vault write lock): shares follow their note or
	 * folder, so addresses keep working. A failure is logged; the move has happened anyway.
	 */
	public void moved(String from, String to, EntryType type, Identity identity) {
		try {
			if (!this.lock.tryLock(5, TimeUnit.SECONDS)) {
				logger.warn("Shares not updated after the move of {}: busy", from);
				return;
			}
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			return;
		}
		try {
			List<Share> shares = this.store.read();
			boolean changed = false;
			List<Share> next = new ArrayList<>();
			for (Share share : shares) {
				String moved = (type == EntryType.FILE) ? (share.path().equals(from) ? to : null)
						: ShareScope.moved(share.path(), from, to);
				if (moved != null) {
					next.add(share.withPath(moved));
					changed = true;
				}
				else {
					next.add(share);
				}
			}
			if (changed) {
				this.store.write(next, Author.of(identity));
				this.hub.publish(new SharesChangedEvent(null));
			}
		}
		catch (IOException | RuntimeException ex) {
			logger.warn("Shares not updated after the move of {}: {}", from, ex.toString());
		}
		finally {
			this.lock.unlock();
		}
	}

	ShareInfo info(Share share) {
		Instant now = this.clock.instant();
		ShareState state = share.expired(now) ? ShareState.EXPIRED
				: targetExists(share) ? ShareState.ACTIVE : ShareState.MISSING;
		Share.Link link = share.link();
		return new ShareInfo(share.id(), share.path(), share.kind(), share.mode(), share.recipients(), link != null,
				(link != null) ? link.createdAt() : null, share.expiresAt(), share.createdAt(), share.createdBy(), state,
				this.prefix + "/s/" + share.id());
	}

	// ---------------------------------------------------------------- guests

	/** The share with this id, whatever its state, or null. */
	public @Nullable Share byId(String id) throws IOException {
		return find(this.store.read(), id);
	}

	/** The share whose link has this token hash, or null. */
	public @Nullable Share byLinkHash(String hash) throws IOException {
		for (Share share : this.store.read()) {
			if (share.link() != null && ShareTokens.sameHash(share.link().hash(), hash)) {
				return share;
			}
		}
		return null;
	}

	/** The unexpired shares naming {@code login}, for the guest landing page. */
	public List<GuestShareSummary> sharesNaming(String login, @Nullable String vault) throws IOException {
		Instant now = this.clock.instant();
		return this.store.read()
			.stream()
			.filter((share) -> share.names(login) && !share.expired(now))
			.sorted(Comparator.comparing(Share::createdAt).reversed())
			.map((share) -> new GuestShareSummary(vault, share.id(), share.kind(), title(share), share.mode(),
					share.createdByName(), this.prefix + "/s/" + share.id()))
			.toList();
	}

	/** {@code GET /api/s/{key}}: what the guest may see of the share. */
	public GuestShareResponse view(Share share, Identity identity) {
		String eventId = this.hub.headEventId();
		List<FolderEntry> folders = new ArrayList<>();
		List<FileEntry> files = new ArrayList<>();
		if (share.kind() == ShareKind.FOLDER) {
			if (this.index.isFolder(share.path())) {
				folders.add(new FolderEntry(share.path(), PathNames.nameOf(share.path())));
				for (String folder : this.index.foldersUnder(share.path())) {
					folders.add(new FolderEntry(folder, PathNames.nameOf(folder)));
				}
				for (FileRecord record : this.index.filesUnder(share.path())) {
					files.add(record.toEntry());
				}
			}
		}
		else {
			FileRecord record = this.index.file(share.path());
			if (record != null) {
				files.add(record.toEntry());
			}
		}
		List<FileEntry> embedded = new ArrayList<>();
		for (String path : embeddedMedia(share)) {
			FileRecord record = this.index.file(path);
			if (record != null) {
				embedded.add(record.toEntry());
			}
		}
		return new GuestShareResponse(share.id(), share.kind(), share.path(), title(share), share.mode(),
				share.createdByName(), share.expiresAt(), eventId, folders, files, embedded, identity.login());
	}

	/**
	 * Images, audio, video and PDFs outside the share that its notes embed now (DESIGN §5.40), as the index resolves
	 * the embeds. Cached per share and index generation; every computation also refreshes the 24-hour memory the check
	 * of a guest's embeds uses.
	 */
	public Set<String> embeddedMedia(Share share) {
		long generation = this.index.generation();
		EmbedCache cached = this.embedCache.get(share.id());
		if (cached != null && cached.generation() == generation && cached.path().equals(share.path())) {
			remember(share.id(), cached.media());
			return cached.media();
		}
		Set<String> media = new LinkedHashSet<>();
		for (String note : notesIn(share)) {
			for (LinkGraph.Resolved link : this.index.outgoingLinks(note)) {
				String target = link.target();
				if (link.occ().embed() && target != null && !share.contains(target) && isMedia(target)) {
					media.add(target);
				}
			}
		}
		Set<String> result = Set.copyOf(media);
		this.embedCache.put(share.id(), new EmbedCache(share.path(), generation, result));
		remember(share.id(), result);
		return result;
	}

	/** True when a guest of the share may fetch {@code path} raw: in scope, or embedded media of the share. */
	public boolean rawAllowed(Share share, String path) {
		return share.contains(path) || embeddedMedia(share).contains(path);
	}

	/**
	 * Refuses a guest's text for {@code notePath} when it adds an embed that reaches outside the share (DESIGN §5.40).
	 * An embed whose target, as written, the note's current text already embeds is never refused (the guest did not
	 * add it). Another embed must resolve inside the share, or to media the share embeds now or did within
	 * {@link #EMBED_GRACE}; an unresolved one is refused, so the answer never tells whether a file exists.
	 */
	public void checkGuestEmbeds(Share share, String notePath, String newText) {
		Set<String> allowed = new HashSet<>(embeddedMedia(share));
		allowed.addAll(remembered(share.id()));
		NoteRecord current = this.index.note(notePath);
		Set<String> existing = new HashSet<>();
		if (current != null) {
			for (LinkOcc occ : current.parse().links()) {
				if (occ.embed()) {
					existing.add(occ.target());
				}
			}
		}
		for (LinkOcc occ : MarkdownScanner.scan(newText, false, false).links()) {
			if (!occ.embed() || existing.contains(occ.target())) {
				continue;
			}
			String target = this.index.resolveLink(occ.target(), notePath);
			if (target != null && (share.contains(target) || allowed.contains(target))) {
				continue;
			}
			throw new NotesException(ErrorCode.OUTSIDE_SHARE,
					"A shared note can only embed files that are shared with it", Map.of("path", notePath));
		}
	}

	/** True when the share's note or folder exists. */
	public boolean targetExists(Share share) {
		if (share.kind() == ShareKind.FOLDER) {
			return this.index.isFolder(share.path());
		}
		FileRecord record = this.index.file(share.path());
		return record != null && record.kind() == FileKind.NOTE;
	}

	/** The share's title for guests: the note's name without its extension, or the folder's name. */
	public static String title(Share share) {
		String name = PathNames.nameOf(share.path());
		return (share.kind() == ShareKind.NOTE) ? PathNames.basenameOf(name) : name;
	}

	public String prefix() {
		return this.prefix;
	}

	public Instant now() {
		return this.clock.instant();
	}

	// ---------------------------------------------------------------- helpers

	private List<String> notesIn(Share share) {
		if (share.kind() == ShareKind.NOTE) {
			return (this.index.note(share.path()) != null) ? List.of(share.path()) : List.of();
		}
		List<String> notes = new ArrayList<>();
		for (FileRecord record : this.index.filesUnder(share.path())) {
			if (record.kind() == FileKind.NOTE) {
				notes.add(record.path());
			}
		}
		return notes;
	}

	private boolean isMedia(String path) {
		FileRecord record = this.index.file(path);
		return record != null && MEDIA.contains(record.kind());
	}

	private void remember(String shareId, Set<String> media) {
		if (media.isEmpty()) {
			return;
		}
		Instant now = this.clock.instant();
		Map<String, Instant> seen = this.rememberedMedia.computeIfAbsent(shareId, (k) -> new LinkedHashMap<>());
		synchronized (seen) {
			for (String path : media) {
				seen.remove(path);
				seen.put(path, now);
			}
			while (seen.size() > MAX_REMEMBERED) {
				seen.remove(seen.keySet().iterator().next());
			}
		}
	}

	private Set<String> remembered(String shareId) {
		Map<String, Instant> seen = this.rememberedMedia.get(shareId);
		if (seen == null) {
			return Set.of();
		}
		Instant cutoff = this.clock.instant().minus(EMBED_GRACE);
		Set<String> out = new HashSet<>();
		synchronized (seen) {
			seen.values().removeIf((at) -> at.isBefore(cutoff));
			out.addAll(seen.keySet());
		}
		return out;
	}

	private void requireAvailable() {
		if (!this.identities.hasOwnerList()) {
			throw new NotesException(ErrorCode.SHARING_UNAVAILABLE,
					"Sharing needs NOTES_IDENTITY_ALLOWED_LOGINS set to your own login: without it every tailnet "
							+ "login has the whole vault");
		}
	}

	private String checkedPath(String raw) {
		String path = Normalizer.normalize(raw, Normalizer.Form.NFC);
		VaultPaths.Violation violation = VaultPaths.safetyViolation(path);
		if (violation != null) {
			throw violation.reserved() ? NotesException.reservedPath(path)
					: NotesException.invalidPath(path, violation.message());
		}
		return path;
	}

	private ShareKind kindOf(String path) {
		if (this.index.isFolder(path)) {
			return ShareKind.FOLDER;
		}
		FileRecord record = this.index.file(path);
		if (record == null) {
			throw NotesException.notFound(path);
		}
		String lower = path.toLowerCase(Locale.ROOT);
		if (record.kind() != FileKind.NOTE || !PathNames.isMarkdown(path) || lower.endsWith(".excalidraw.md")) {
			throw NotesException.badRequest("Only a Markdown note or a folder can be shared");
		}
		return ShareKind.NOTE;
	}

	private static List<String> recipients(@Nullable List<String> raw) {
		List<String> out = new ArrayList<>();
		if (raw == null) {
			return out;
		}
		for (String entry : raw) {
			String login = (entry != null) ? entry.strip() : "";
			if (!ShareStore.isValidLogin(login)) {
				throw NotesException.badRequest(
						"A person is named by their Tailscale login, such as name@example.com: " + abbreviate(login));
			}
			if (out.stream().noneMatch((r) -> r.equalsIgnoreCase(login))) {
				out.add(login);
			}
		}
		if (out.size() > MAX_RECIPIENTS) {
			throw NotesException.badRequest("At most " + MAX_RECIPIENTS + " people per share");
		}
		return out;
	}

	private static String abbreviate(String text) {
		return (text.length() > 60) ? text.substring(0, 60) + "…" : text;
	}

	private static @Nullable Share find(List<Share> shares, String id) {
		return shares.stream().filter((s) -> s.id().equals(id)).findFirst().orElse(null);
	}

	private void lock() {
		try {
			if (!this.lock.tryLock(5, TimeUnit.SECONDS)) {
				throw NotesException.busy();
			}
		}
		catch (InterruptedException ex) {
			Thread.currentThread().interrupt();
			throw NotesException.busy();
		}
	}

}
