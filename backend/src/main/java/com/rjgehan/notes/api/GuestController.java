package com.rjgehan.notes.api;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;

import com.rjgehan.notes.api.dto.CreateFileRequest;
import com.rjgehan.notes.api.dto.GuestLandingResponse;
import com.rjgehan.notes.api.dto.GuestShareResponse;
import com.rjgehan.notes.api.dto.GuestShareSummary;
import com.rjgehan.notes.api.dto.OnConflict;
import com.rjgehan.notes.api.dto.SaveFileRequest;
import com.rjgehan.notes.api.dto.TextFile;
import com.rjgehan.notes.api.dto.WriteResult;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.config.ApiGuardInterceptor;
import com.rjgehan.notes.config.NotesProperties;
import com.rjgehan.notes.events.EventHub;
import com.rjgehan.notes.identity.Identity;
import com.rjgehan.notes.share.GuestEventFilter;
import com.rjgehan.notes.share.ShareAccess;
import com.rjgehan.notes.share.ShareService;
import com.rjgehan.notes.vault.FileService;
import com.rjgehan.notes.vaults.VaultRegistry;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * The guest surface's API (API.md §42.5 to §42.10, DESIGN §5.40): the only endpoints a login outside the owner list
 * reaches. Every endpoint opens the share its key names through {@link ShareAccess} and checks every path against the
 * share's scope before any file is touched. Responses are the owner API's records, so the guest page's save, conflict
 * and sync code is the owner's.
 */
@RestController
public class GuestController {

	private static final Logger logger = LoggerFactory.getLogger(GuestController.class);

	private final ShareAccess access;

	private final ShareService shares;

	private final FileService files;

	private final RawResponses raw;

	private final EventHub hub;

	private final IdempotencyCache idempotency;

	private final ObjectProvider<VaultRegistry> registry;

	private final NotesProperties.Vaults vaults;

	public GuestController(ShareAccess access, ShareService shares, FileService files, RawResponses raw, EventHub hub,
			IdempotencyCache idempotency, ObjectProvider<VaultRegistry> registry, NotesProperties properties) {
		this.access = access;
		this.shares = shares;
		this.files = files;
		this.raw = raw;
		this.hub = hub;
		this.idempotency = idempotency;
		this.registry = registry;
		this.vaults = properties.vaults();
	}

	/**
	 * {@code GET /api/s}: who is asking, and the shares naming that login. The default vault's answer covers every
	 * running vault; an extra vault's covers itself.
	 */
	@GetMapping("/api/s")
	GuestLandingResponse landing(Identity identity) throws IOException {
		this.access.checkRate(identity);
		List<GuestShareSummary> found = new ArrayList<>(
				this.shares.sharesNaming(identity.login(), this.vaults.isDefault() ? null : this.vaults.currentName()));
		VaultRegistry vaultRegistry = this.vaults.isDefault() ? this.registry.getIfAvailable() : null;
		if (vaultRegistry != null) {
			for (VaultRegistry.Info info : vaultRegistry.list()) {
				if (info.isDefault() || info.state() != VaultRegistry.State.READY) {
					continue;
				}
				ConfigurableApplicationContext context = vaultRegistry.context(info.name());
				if (context == null) {
					continue;
				}
				try {
					found.addAll(context.getBean(ShareService.class).sharesNaming(identity.login(), info.name()));
				}
				catch (IOException | RuntimeException ex) {
					logger.warn("The shares of vault {} could not be read: {}", info.name(), ex.toString());
				}
			}
		}
		return new GuestLandingResponse(identity.login(), identity.name(), found);
	}

	/** {@code GET /api/s/{key}}: the share as the guest may see it. */
	@GetMapping("/api/s/{key}")
	GuestShareResponse share(@PathVariable String key, Identity identity) throws IOException {
		ShareAccess.Grant grant = this.access.open(key, identity);
		return this.shares.view(grant.share(), identity);
	}

	/** {@code GET /api/s/{key}/files?path=}: a text file of the share. */
	@GetMapping("/api/s/{key}/files")
	TextFile read(@PathVariable String key, @RequestParam(required = false) @Nullable String path, Identity identity)
			throws IOException {
		ShareAccess.Grant grant = this.access.open(key, identity);
		return this.files.readText(this.access.readable(grant, path));
	}

	/** {@code PUT /api/s/{key}/files?path=}: the save of API.md §4, for a note of an edit share. */
	@PutMapping("/api/s/{key}/files")
	ResponseEntity<WriteResult> save(@PathVariable String key, @RequestParam(required = false) @Nullable String path,
			@Valid @RequestBody SaveFileRequest request, Identity identity,
			@RequestHeader(name = ApiGuardInterceptor.CLIENT_ID_HEADER, required = false) @Nullable String origin)
			throws IOException {
		ShareAccess.Grant grant = this.access.open(key, identity);
		String checked = this.access.writable(grant, path);
		this.access.checkEmbeds(grant, checked, request.content());
		FileService.Saved saved = this.files.saveText(checked, request.content(), request.baseVersion(),
				Boolean.TRUE.equals(request.flushHistory()), identity, origin);
		return ResponseEntity.status(saved.created() ? HttpStatus.CREATED : HttpStatus.OK).body(saved.result());
	}

	/** {@code POST /api/s/{key}/files}: a new note inside the folder of an edit share. */
	@PostMapping("/api/s/{key}/files")
	ResponseEntity<WriteResult> create(@PathVariable String key, @Valid @RequestBody CreateFileRequest request,
			Identity identity,
			@RequestHeader(name = ApiGuardInterceptor.CLIENT_ID_HEADER, required = false) @Nullable String origin,
			@RequestHeader(name = IdempotencyCache.HEADER, required = false) @Nullable String idempotencyKey,
			HttpServletRequest http) throws IOException {
		ShareAccess.Grant grant = this.access.open(key, identity);
		String checked = this.access.creatable(grant, request.path());
		String content = (request.content() != null) ? request.content() : "";
		this.access.checkEmbeds(grant, checked, content);
		return this.idempotency.execute(idempotencyKey, http, () -> {
			WriteResult result = this.files.createText(checked, content,
					(request.onConflict() != null) ? request.onConflict() : OnConflict.FAIL, identity, origin);
			return ResponseEntity.created(FileController.location(result.file().path())).body(result);
		});
	}

	/** {@code GET /api/s/{key}/files/raw?path=}: a file of the share, or media its notes embed. */
	@GetMapping("/api/s/{key}/files/raw")
	ResponseEntity<Resource> raw(@PathVariable String key, @RequestParam(required = false) @Nullable String path,
			@RequestParam(required = false) @Nullable String v, @RequestParam(defaultValue = "false") boolean download,
			Identity identity) throws IOException {
		ShareAccess.Grant grant = this.access.open(key, identity);
		return this.raw.file(this.files.openRaw(this.access.raw(grant, path)), v, download);
	}

	/** {@code GET /api/s/{key}/events}: the share's event stream (API.md §16 protocol, always resyncing). */
	@GetMapping("/api/s/{key}/events")
	ResponseEntity<SseEmitter> events(@PathVariable String key, @RequestParam(required = false) @Nullable String clientId,
			@RequestParam(required = false) @Nullable String lastEventId,
			@RequestHeader(name = "Last-Event-ID", required = false) @Nullable String lastEventIdHeader,
			Identity identity) throws IOException {
		ShareAccess.Grant grant = this.access.open(key, identity);
		if (!ApiGuardInterceptor.isValidClientId(clientId)) {
			throw NotesException.badRequest("clientId must be 8 to 64 letters, digits or dashes");
		}
		String last = (lastEventIdHeader != null && !lastEventIdHeader.isBlank()) ? lastEventIdHeader : lastEventId;
		SseEmitter emitter = this.hub.connect(this.hub.newEmitter(), clientId, last,
				new GuestEventFilter(this.access, this.shares, grant));
		return ResponseEntity.ok()
			.cacheControl(CacheControl.noCache().noTransform())
			.header("X-Accel-Buffering", "no")
			.body(emitter);
	}

}
