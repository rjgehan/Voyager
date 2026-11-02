package com.rjgehan.notes.share;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.NoSuchFileException;
import java.nio.file.attribute.BasicFileAttributes;
import java.text.Normalizer;
import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.rjgehan.notes.api.dto.ShareKind;
import com.rjgehan.notes.api.dto.ShareMode;
import com.rjgehan.notes.api.error.ErrorCode;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.config.JsonConfig;
import com.rjgehan.notes.history.Author;
import com.rjgehan.notes.history.CommitBatcher;
import com.rjgehan.notes.vault.ApiPath;
import com.rjgehan.notes.vault.Hashing;
import com.rjgehan.notes.vault.TextCodec;
import com.rjgehan.notes.vault.VaultFs;
import com.rjgehan.notes.vault.VaultPaths;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

import org.springframework.stereotype.Component;

/**
 * {@code .notesapp/shares.json} (DESIGN §5.40): read leniently (hand edits are taken as far as they are well formed),
 * cached by the file's blob id, written atomically and marked for the next history batch. Callers serialize writes
 * ({@link ShareService} holds its lock around read-modify-write).
 */
@Component
public class ShareStore {

	private static final Logger logger = LoggerFactory.getLogger(ShareStore.class);

	public static final String FILE = ".notesapp/shares.json";

	private static final ApiPath PATH = ApiPath.of(FILE);

	static final int MAX_LOGIN = 254;

	private static final JsonNodeFactory NODES = JsonNodeFactory.instance;

	/** The parsed file, with the size and modification time it had (a stat decides whether to read it again). */
	private record Cached(String version, long size, Instant mtime, List<Share> shares) {
	}

	private final VaultFs fs;

	private final CommitBatcher batcher;

	private final JsonMapper mapper;

	private volatile @Nullable Cached cached;

	public ShareStore(VaultFs fs, CommitBatcher batcher, JsonMapper mapper) {
		this.fs = fs;
		this.batcher = batcher;
		this.mapper = mapper;
	}

	/**
	 * The shares as the file has them now; an absent file is no shares. Guests' requests and event streams ask often,
	 * so the file is read again only when its size or modification time changed, and parsed again only when its bytes
	 * did.
	 */
	public List<Share> read() throws IOException {
		BasicFileAttributes attributes = this.fs.attributes(FILE);
		if (attributes == null || !attributes.isRegularFile()) {
			return List.of();
		}
		Cached current = this.cached;
		Instant mtime = attributes.lastModifiedTime().toInstant();
		if (current != null && current.size() == attributes.size() && current.mtime().equals(mtime)) {
			return current.shares();
		}
		byte[] bytes;
		try {
			bytes = this.fs.readBytes(FILE);
		}
		catch (NoSuchFileException ex) {
			return List.of();
		}
		String version = Hashing.blobId(bytes);
		List<Share> shares = (current != null && current.version().equals(version)) ? current.shares()
				: parse(TextCodec.decode(bytes).text());
		this.cached = new Cached(version, bytes.length, mtime, shares);
		return shares;
	}

	/** Replaces the file's shares, committed with the next batch under {@code author}. */
	public void write(List<Share> shares, Author author) throws IOException {
		ObjectNode root = NODES.objectNode();
		ArrayNode list = root.putArray("shares");
		for (Share share : shares) {
			list.add(toNode(share));
		}
		byte[] bytes = (JsonConfig.vaultFileWriter(this.mapper).writeValueAsString(root) + "\n")
			.getBytes(StandardCharsets.UTF_8);
		this.batcher.prepareWrite(author);
		this.fs.atomicWrite(FILE, bytes);
		this.batcher.markDirty(PATH, author);
		BasicFileAttributes attributes = this.fs.attributes(FILE);
		this.cached = (attributes != null) ? new Cached(Hashing.blobId(bytes), attributes.size(),
				attributes.lastModifiedTime().toInstant(), List.copyOf(shares)) : null;
	}

	List<Share> parse(String text) {
		JsonNode root;
		try {
			root = this.mapper.readTree(text);
		}
		catch (JacksonException ex) {
			throw new NotesException(ErrorCode.MALFORMED_FILE, FILE + " is not valid JSON; fix or delete it",
					Map.of("path", FILE, "reason", "not JSON"));
		}
		JsonNode list = (root != null) ? root.get("shares") : null;
		if (list == null || !list.isArray()) {
			return List.of();
		}
		List<Share> out = new ArrayList<>();
		Set<String> ids = new LinkedHashSet<>();
		for (JsonNode node : list) {
			Share share = fromNode(node);
			if (share == null || !ids.add(share.id())) {
				logger.warn("{}: an entry that is not a valid share was skipped", FILE);
				continue;
			}
			out.add(share);
		}
		return List.copyOf(out);
	}

	private static @Nullable Share fromNode(JsonNode node) {
		if (!node.isObject()) {
			return null;
		}
		String id = text(node, "id");
		String rawPath = text(node, "path");
		ShareKind kind = kind(text(node, "kind"));
		ShareMode mode = mode(text(node, "mode"));
		if (id == null || !ShareTokens.isId(id) || rawPath == null || kind == null || mode == null) {
			return null;
		}
		String path = Normalizer.normalize(rawPath, Normalizer.Form.NFC);
		if (VaultPaths.safetyViolation(path) != null) {
			return null;
		}
		List<String> recipients = new ArrayList<>();
		JsonNode list = node.get("recipients");
		if (list != null && list.isArray()) {
			for (JsonNode recipient : list) {
				String login = recipient.isString() ? recipient.stringValue().strip() : null;
				if (login != null && isValidLogin(login)
						&& recipients.stream().noneMatch((r) -> r.equalsIgnoreCase(login))) {
					recipients.add(login);
				}
			}
		}
		Share.Link link = null;
		JsonNode linkNode = node.get("link");
		if (linkNode != null && linkNode.isObject()) {
			String hash = text(linkNode, "hash");
			Instant linkCreated = instant(text(linkNode, "createdAt"));
			if (hash != null && ShareTokens.HASH.matcher(hash).matches()) {
				link = new Share.Link(hash, (linkCreated != null) ? linkCreated : Instant.EPOCH);
			}
		}
		Instant created = instant(text(node, "createdAt"));
		String createdBy = text(node, "createdBy");
		String createdByName = text(node, "createdByName");
		return new Share(id, path, kind, mode, recipients, link, instant(text(node, "expiresAt")),
				(created != null) ? created : Instant.EPOCH, (createdBy != null) ? createdBy : "",
				(createdByName != null) ? createdByName : ((createdBy != null) ? createdBy : ""));
	}

	private static ObjectNode toNode(Share share) {
		ObjectNode node = NODES.objectNode();
		node.put("id", share.id());
		node.put("path", share.path());
		node.put("kind", (share.kind() == ShareKind.NOTE) ? "note" : "folder");
		node.put("mode", (share.mode() == ShareMode.EDIT) ? "edit" : "read");
		ArrayNode recipients = node.putArray("recipients");
		share.recipients().forEach(recipients::add);
		if (share.link() != null) {
			ObjectNode link = node.putObject("link");
			link.put("hash", share.link().hash());
			link.put("createdAt", JsonConfig.formatInstant(share.link().createdAt()));
		}
		else {
			node.putNull("link");
		}
		if (share.expiresAt() != null) {
			node.put("expiresAt", JsonConfig.formatInstant(share.expiresAt()));
		}
		else {
			node.putNull("expiresAt");
		}
		node.put("createdAt", JsonConfig.formatInstant(share.createdAt()));
		node.put("createdBy", share.createdBy());
		node.put("createdByName", share.createdByName());
		return node;
	}

	/**
	 * A Tailscale login as the identity header carries it: 1 to 254 characters with an {@code @} that is neither first
	 * nor last, and no whitespace or control characters ({@code you@example.com}, {@code you@github}).
	 */
	public static boolean isValidLogin(String login) {
		if (login.isEmpty() || login.length() > MAX_LOGIN) {
			return false;
		}
		int at = login.indexOf('@');
		if (at <= 0 || at == login.length() - 1) {
			return false;
		}
		for (int i = 0; i < login.length(); i++) {
			char c = login.charAt(i);
			if (Character.isWhitespace(c) || Character.isISOControl(c) || c == '"' || c == '<' || c == '>') {
				return false;
			}
		}
		return true;
	}

	private static @Nullable String text(JsonNode node, String field) {
		JsonNode value = node.get(field);
		return (value != null && value.isString()) ? value.stringValue() : null;
	}

	private static @Nullable Instant instant(@Nullable String text) {
		if (text == null) {
			return null;
		}
		try {
			return Instant.parse(text);
		}
		catch (DateTimeParseException ex) {
			return null;
		}
	}

	private static @Nullable ShareKind kind(@Nullable String text) {
		if ("note".equals(text)) {
			return ShareKind.NOTE;
		}
		return "folder".equals(text) ? ShareKind.FOLDER : null;
	}

	private static @Nullable ShareMode mode(@Nullable String text) {
		if ("read".equals(text)) {
			return ShareMode.READ;
		}
		return "edit".equals(text) ? ShareMode.EDIT : null;
	}

}
