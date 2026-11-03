package com.rjgehan.notes.api;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import com.rjgehan.notes.history.CommitBatcher;
import com.rjgehan.notes.share.ShareRateLimiter;
import com.rjgehan.notes.share.ShareTokens;
import com.rjgehan.notes.support.Api;
import com.rjgehan.notes.support.Api.Reply;
import com.rjgehan.notes.support.IntegrationProperties;
import com.rjgehan.notes.support.NotesIntegrationTest;
import com.rjgehan.notes.support.RawHttp;
import com.rjgehan.notes.support.SseRecorder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.client.RestTestClient;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.springframework.web.util.pattern.PathPattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * Sharing with family is deny by default (ROADMAP item 43, DESIGN §5.40, API.md §42), checked as production runs it:
 * no default identity, one owner. Every handler mapping of the application, asked by a guest and by a stranger, is
 * refused unless it is guest surface; the guest surface is exactly the guest endpoints and pages; and every guest
 * endpoint checks who may use which key, the share's scope whatever the spelling of a path, read against edit, the
 * embeds a guest adds, the rate limit, and revocation and expiry, event streams included.
 */
@NotesIntegrationTest
class ShareAuthorizationIntegrationTest {

	private static final String LOGIN = "Tailscale-User-Login";

	private static final String OWNER = "owner@example.com";

	private static final String MOM = "mom@example.com";

	private static final String DAD = "dad@example.com";

	private static final String STRANGER = "stranger@example.com";

	private static final byte[] PNG = { (byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 1, 2, 3, 4 };

	private static final byte[] SECRET = { (byte) 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 6, 6, 6, 6 };

	@TempDir
	static Path vault;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		IntegrationProperties.register(registry, () -> vault,
				Map.of("notes.identity.allow-default", "false", "notes.identity.allowed-logins", OWNER));
	}

	/** S1: Family/Groceries.md, edit, for mom and by link. S2: Family/Recipes, read, for dad. S3: Family/Recipes, edit, for mom. */
	private static String noteShare;

	private static String noteToken;

	private static String readFolderShare;

	private static String editFolderShare;

	@LocalServerPort
	int port;

	@Autowired
	RestTestClient client;

	@Autowired
	CommitBatcher batcher;

	@Autowired
	@Qualifier("requestMappingHandlerMapping")
	RequestMappingHandlerMapping mappings;

	private Api api;

	@BeforeEach
	void setUp() {
		this.api = new Api(this.client);
		await().atMost(Duration.ofSeconds(30)).until(() -> !this.batcher.isImporting());
		if (noteShare == null) {
			fixture();
		}
	}

	private void fixture() {
		create("Family/Groceries.md", "# Groceries\n\n- [ ] milk\n\n![[photo.png]]\n\nSee [[Diary]] and ![[missing.png]]\n");
		upload("Attachments/photo.png", PNG);
		upload("Attachments/secret.png", SECRET);
		create("Private/Diary.md", "# Diary\nsecret entry\n");
		create("Family/Recipes/Pie.md", "# Pie\n\n![[pie.png]]\n");
		upload("Family/Recipes/pie.png", PNG);
		create("Family/Recipes/Crème.md", "Crème brûlée\n");
		create("Family/Recipes/board.canvas", "{\"nodes\":[],\"edges\":[]}\n");
		create("Family/Recipes2/Secret.md", "a sibling folder with the same prefix\n");
		create("Family/Other.md", "next to the shared note\n");
		JsonNode first = owner().postJson("/api/shares",
				Map.of("path", "Family/Groceries.md", "mode", "edit", "recipients", List.of(MOM), "link", true), LOGIN,
				OWNER)
			.ok(201);
		noteShare = first.get("share").get("id").asString();
		String link = first.get("link").asString();
		assertThat(link).startsWith("/s/");
		noteToken = link.substring("/s/".length());
		readFolderShare = owner()
			.postJson("/api/shares", Map.of("path", "Family/Recipes", "mode", "read", "recipients", List.of(DAD)),
					LOGIN, OWNER)
			.ok(201)
			.get("share")
			.get("id")
			.asString();
		editFolderShare = owner()
			.postJson("/api/shares", Map.of("path", "Family/Recipes", "mode", "edit", "recipients", List.of(MOM)),
					LOGIN, OWNER)
			.ok(201)
			.get("share")
			.get("id")
			.asString();
	}

	private Api owner() {
		return this.api;
	}

	private void create(String path, String content) {
		this.api.postJson("/api/files", Map.of("path", path, "content", content), LOGIN, OWNER).ok(201);
	}

	private void upload(String path, byte[] bytes) {
		this.api.putBytes("/api/files/raw?path=" + Api.enc(path), bytes, LOGIN, OWNER).ok(201);
	}

	private Reply as(String login, String method, String uri, Object body) {
		return switch (method) {
			case "GET" -> this.api.get(uri, LOGIN, login);
			case "DELETE" -> this.api.delete(uri, LOGIN, login);
			case "POST" -> this.api.postJson(uri, body, LOGIN, login);
			case "PUT" -> this.api.putJson(uri, body, LOGIN, login);
			case "PATCH" -> this.api.patchJson(uri, body, LOGIN, login);
			default -> throw new IllegalArgumentException(method);
		};
	}

	// ---------------------------------------------------------------- deny by default

	/** Every mapped path and method, with its variables filled in, outside the guest surface. */
	private record Endpoint(String method, String pattern, String path) {
	}

	private List<Endpoint> endpoints() {
		List<Endpoint> out = new ArrayList<>();
		for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : this.mappings.getHandlerMethods().entrySet()) {
			RequestMappingInfo info = entry.getKey();
			Set<RequestMethod> declared = info.getMethodsCondition().getMethods();
			List<String> methods = declared.isEmpty() ? List.of("GET", "POST", "PUT", "DELETE")
					: declared.stream().map(RequestMethod::name).filter((m) -> !m.equals("HEAD") && !m.equals("OPTIONS")).toList();
			for (PathPattern pattern : info.getPathPatternsCondition().getPatterns()) {
				for (String method : methods) {
					out.add(new Endpoint(method, pattern.getPatternString(), fill(pattern.getPatternString())));
				}
			}
		}
		assertThat(out).hasSizeGreaterThan(100);
		return out;
	}

	/** A request path matching {@code pattern}: each variable becomes {@code x1}, each wildcard a segment. */
	static String fill(String pattern) {
		StringBuilder out = new StringBuilder();
		for (int i = 0; i < pattern.length(); i++) {
			char c = pattern.charAt(i);
			if (c == '{') {
				int depth = 1;
				int j = i + 1;
				while (j < pattern.length() && depth > 0) {
					depth += (pattern.charAt(j) == '{') ? 1 : (pattern.charAt(j) == '}') ? -1 : 0;
					j++;
				}
				out.append("x1");
				i = j - 1;
			}
			else if (c == '*') {
				out.append("x2");
				while (i + 1 < pattern.length() && pattern.charAt(i + 1) == '*') {
					i++;
				}
			}
			else {
				out.append(c);
			}
		}
		return out.toString();
	}

	private static boolean guestSurface(String method, String path) {
		boolean read = method.equals("GET") || method.equals("HEAD");
		return path.equals("/api/s") || path.startsWith("/api/s/") || path.equals("/")
				|| (read && (path.equals("/s") || path.startsWith("/s/") || path.matches("/v/[a-z0-9-]+/s(/.*)?")));
	}

	@Test
	void everyEndpointOutsideTheGuestSurfaceRefusesGuestsAndStrangers() {
		List<String> checked = new ArrayList<>();
		for (Endpoint endpoint : endpoints()) {
			if (guestSurface(endpoint.method(), endpoint.path())) {
				continue;
			}
			for (String login : List.of(MOM, STRANGER)) {
				Reply reply = as(login, endpoint.method(), endpoint.path(), Map.of("path", "Family/Groceries.md"));
				assertThat(reply.problem(403)).as(endpoint + " as " + login).isEqualTo("identity-not-allowed");
			}
			// The same request under an extra vault's prefix is the same request (DESIGN §5.39).
			if (endpoint.path().startsWith("/api/")) {
				Reply prefixed = as(MOM, endpoint.method(), "/api/v/work" + endpoint.path().substring(4),
						Map.of("path", "x.md"));
				assertThat(prefixed.problem(403)).as("prefixed " + endpoint).isEqualTo("identity-not-allowed");
			}
			checked.add(endpoint.method() + " " + endpoint.pattern());
		}
		// The owner API of shares, settings, files, the event stream and the app are among them.
		assertThat(checked).contains("GET /api/shares", "POST /api/shares", "PUT /api/shares/{id}",
				"DELETE /api/shares/{id}", "GET /api/tree", "GET /api/files", "PUT /api/files", "GET /api/files/raw",
				"GET /api/search", "GET /api/settings", "GET /api/events", "GET /api/history", "GET /api/me",
				"GET /api/notes/backlinks", "POST /api/ai/ask", "GET /api/publish", "GET /api/vaults");
	}

	@Test
	void theOwnerIsAdmittedEverywhere() {
		for (Endpoint endpoint : endpoints()) {
			if (endpoint.method().equals("GET")) {
				// Every GET is side-effect free (API.md §2): whatever it answers, it is not the identity refusal.
				Reply reply = this.api.get(endpoint.path(), LOGIN, OWNER);
				assertThat(reply.text()).as(endpoint.toString()).doesNotContain("identity-not-allowed");
			}
			else if (endpoint.path().startsWith("/api/")) {
				// A write without a client id passes admission and stops at the CSRF guard, before any handler runs.
				Reply reply = switch (endpoint.method()) {
					case "DELETE" -> this.api.delete(endpoint.path(), LOGIN, OWNER, "X-Client-Id", null);
					case "POST" -> this.api.postJson(endpoint.path(), Map.of(), LOGIN, OWNER, "X-Client-Id", null);
					case "PUT" -> this.api.putJson(endpoint.path(), Map.of(), LOGIN, OWNER, "X-Client-Id", null);
					default -> this.api.patchJson(endpoint.path(), Map.of(), LOGIN, OWNER, "X-Client-Id", null);
				};
				assertThat(reply.problem(403)).as(endpoint.toString()).isEqualTo("client-id-required");
			}
		}
	}

	@Test
	void theGuestSurfaceIsExactlyTheGuestEndpointsAndPages() {
		Set<String> surface = new TreeSet<>();
		for (Endpoint endpoint : endpoints()) {
			if (guestSurface(endpoint.method(), endpoint.path())) {
				surface.add(endpoint.method() + " " + endpoint.pattern());
			}
		}
		assertThat(surface).containsExactlyInAnyOrder("GET /api/s", "GET /api/s/{key}", "GET /api/s/{key}/files",
				"PUT /api/s/{key}/files", "POST /api/s/{key}/files", "GET /api/s/{key}/files/raw",
				"GET /api/s/{key}/events", "GET /s", "GET /s/**", "GET /v/{vault:[a-z0-9-]{1,32}}/s",
				"GET /v/{vault:[a-z0-9-]{1,32}}/s/**", "GET /");
	}

	@Test
	void guestsGetTheirLandingPageForTheAppAndNothingOfTheOwnersFiles() throws Exception {
		Reply root = this.api.get("/", LOGIN, MOM);
		assertThat(root.status()).isEqualTo(303);
		assertThat(root.header("Location")).isEqualTo("/s");
		for (String file : List.of("/sw.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png",
				"/clipper/clip.js", "/n/Family/Groceries.md", "/x/tasks", "/v/work/", "/v/work/n/x", "/capture",
				"/clip", "/error")) {
			assertThat(this.api.get(file, LOGIN, STRANGER).problem(403)).as(file).isEqualTo("identity-not-allowed");
		}
		// Escapes, parameters and dot segments decide on the path Spring matches.
		for (String target : List.of("/api/%73hares", "/api/s/%2e%2e/tree", "/api/s/x/..%2f..%2ftree", "/%61pi/tree",
				"/api;x=1/tree", "/s/../api/tree", "/api/s/" + noteShare + "/../../tree")) {
			RawHttp.Response raw = RawHttp.exchange(this.port,
					"GET " + target + " HTTP/1.1\nHost: localhost\n" + LOGIN + ": " + MOM + "\nConnection: close");
			assertThat(raw.status()).as(target).isIn(400, 403, 404);
			assertThat(raw.body()).as(target).doesNotContain("Groceries").doesNotContain("Diary");
		}
	}

	@Test
	void withoutAnIdentityNothingAnswersNotEvenALink() {
		for (String uri : List.of("/api/s", "/api/s/" + noteToken, "/api/s/" + noteShare,
				"/api/s/" + noteToken + "/files?path=" + Api.enc("Family/Groceries.md"), "/s/" + noteToken, "/s")) {
			assertThat(this.api.get(uri).problem(403)).as(uri).isEqualTo("identity-not-allowed");
		}
	}

	// ---------------------------------------------------------------- who opens what

	@Test
	void recipientsOpenTheirSharesByIdAndAnyoneOpensALinkButNobodyElse() {
		String note = "/api/s/" + noteShare;
		assertThat(this.api.get(note, LOGIN, MOM).ok(200).get("path").asString()).isEqualTo("Family/Groceries.md");
		assertThat(this.api.get(note, LOGIN, "MOM@Example.com").ok(200).get("login").asString())
			.isEqualTo("MOM@Example.com");
		assertThat(this.api.get(note, LOGIN, OWNER).ok(200).get("mode").asString()).isEqualTo("edit");
		assertThat(this.api.get(note, LOGIN, DAD).problem(404)).isEqualTo("share-not-found");
		assertThat(this.api.get(note + "/files?path=" + Api.enc("Family/Groceries.md"), LOGIN, DAD).problem(404))
			.isEqualTo("share-not-found");
		assertThat(this.api.get(note, LOGIN, "who1@example.com").problem(404)).isEqualTo("share-not-found");
		JsonNode byLink = this.api.get("/api/s/" + noteToken, LOGIN, "who1@example.com").ok(200);
		assertThat(byLink.get("id").asString()).isEqualTo(noteShare);
		assertThat(this.api.get("/api/s/" + readFolderShare, LOGIN, DAD).ok(200).get("kind").asString())
			.isEqualTo("folder");
		assertThat(this.api.get("/api/s/" + readFolderShare, LOGIN, MOM).problem(404)).isEqualTo("share-not-found");
		// The id is not a link, and a link's hash is not one either.
		assertThat(this.api.get("/api/s/" + ShareTokens.hash(noteToken), LOGIN, "who1@example.com").problem(404))
			.isEqualTo("share-not-found");
		assertThat(this.api.get("/api/s/" + noteToken.toLowerCase(Locale.ROOT), LOGIN, "who1@example.com")
			.status()).isEqualTo(404);
	}

	@Test
	void everyGuestEndpointAnswersTheSameForABadKey() {
		String file = "?path=" + Api.enc("Family/Groceries.md");
		List<String> keys = List.of(ShareTokens.newId(), ShareTokens.newToken(), "short", noteShare + "x",
				noteToken.substring(1), "ABCDEFGHIJKL");
		int n = 0;
		for (String key : keys) {
			String login = "keys" + (n++) + "@example.com";
			String base = "/api/s/" + key;
			assertThat(this.api.get(base, LOGIN, login).problem(404)).isEqualTo("share-not-found");
			assertThat(this.api.get(base + "/files" + file, LOGIN, login).problem(404)).isEqualTo("share-not-found");
			assertThat(this.api.get(base + "/files/raw" + file, LOGIN, login).problem(404))
				.isEqualTo("share-not-found");
			assertThat(this.api.putJson(base + "/files" + file, Map.of("content", "x"), LOGIN, login).problem(404))
				.isEqualTo("share-not-found");
			assertThat(this.api.postJson(base + "/files", Map.of("path", "Family/New.md"), LOGIN, login).problem(404))
				.isEqualTo("share-not-found");
			assertThat(this.api.get(base + "/events?clientId=guest-client-01", LOGIN, login).problem(404))
				.isEqualTo("share-not-found");
		}
	}

	// ---------------------------------------------------------------- scope

	@Test
	void pathsOutsideTheScopeAreRefusedWhateverTheirSpelling() {
		String note = "/api/s/" + noteShare;
		assertThat(this.api.get(note + "/files?path=" + Api.enc("Family/Groceries.md"), LOGIN, MOM)
			.ok(200)
			.get("content")
			.asString()).contains("milk");
		int n = 0;
		for (String path : List.of("Private/Diary.md", "Family/Other.md", "family/groceries.md", "Family/Groceries.MD",
				"Family/Groceries.md/../../Private/Diary.md", "Family/../Private/Diary.md", "/Family/Groceries.md",
				"Family\\Groceries.md", "Family//Groceries.md", "./Family/Groceries.md", ".notesapp/shares.json",
				".git/config", ".trash/x.md", "Family", "", " Family/Groceries.md", "Family/Groceries.md ",
				"Attachments/photo.png")) {
			// A fresh login each time, so the rate limit does not end the test early.
			String login = "scope" + (n++) + "@example.com";
			String key = "/api/s/" + noteToken;
			Reply read = this.api.get(key + "/files?path=" + Api.enc(path), LOGIN, login);
			assertThat(read.status()).as(path).isIn(400, 403);
			assertThat(read.text()).as(path).doesNotContain("secret entry").doesNotContain("milk");
			Reply save = this.api.putJson(key + "/files?path=" + Api.enc(path),
					Map.of("content", "overwritten", "baseVersion", "0".repeat(40)), LOGIN, login);
			assertThat(save.status()).as("save " + path).isIn(400, 403);
		}
		assertThat(Files.exists(vault.resolve("Private/Diary.md"))).isTrue();
		assertThat(this.api.get("/api/files?path=" + Api.enc("Private/Diary.md"), LOGIN, OWNER)
			.ok(200)
			.get("content")
			.asString()).contains("secret entry");

		// A folder share: everything under the folder, nothing beside it, and not the folder itself.
		String folder = "/api/s/" + readFolderShare;
		assertThat(this.api.get(folder + "/files?path=" + Api.enc("Family/Recipes/Pie.md"), LOGIN, DAD).status())
			.isEqualTo(200);
		assertThat(this.api.get(folder + "/files?path=" + Api.enc("Family/Recipes/Crème.md"), LOGIN, DAD)
			.ok(200)
			.get("path")
			.asString()).isEqualTo("Family/Recipes/Crème.md");
		// The decomposed spelling is the same note (paths are NFC before the scope is checked).
		assertThat(this.api.get(folder + "/files?path=" + Api.enc("Family/Recipes/Crème.md"), LOGIN, DAD)
			.ok(200)
			.get("path")
			.asString()).isEqualTo("Family/Recipes/Crème.md");
		for (String path : List.of("Family/Recipes2/Secret.md", "Family/Recipes", "Family/Other.md",
				"Family/Recipes/../Recipes2/Secret.md")) {
			Reply reply = this.api.get(folder + "/files?path=" + Api.enc(path), LOGIN, DAD);
			assertThat(reply.status()).as(path).isIn(400, 403);
		}
	}

	@Test
	void rawFilesAreTheScopeAndTheMediaItsNotesEmbed() {
		String key = "/api/s/" + noteShare;
		Reply photo = this.api.get(key + "/files/raw?path=" + Api.enc("Attachments/photo.png"), LOGIN, MOM);
		assertThat(photo.status()).isEqualTo(200);
		assertThat(photo.body()).isEqualTo(PNG);
		assertThat(photo.header("Content-Security-Policy")).startsWith("sandbox");
		assertThat(this.api.get(key + "/files/raw?path=" + Api.enc("Attachments/secret.png"), LOGIN, MOM).problem(403))
			.isEqualTo("outside-share");
		assertThat(this.api.get(key + "/files/raw?path=" + Api.enc("Private/Diary.md"), LOGIN, MOM).problem(403))
			.isEqualTo("outside-share");
		// The note links to Diary but does not embed it; the missing embed resolves nowhere.
		assertThat(this.api.get(key + "/files/raw?path=" + Api.enc("missing.png"), LOGIN, MOM).problem(403))
			.isEqualTo("outside-share");
		String folder = "/api/s/" + readFolderShare;
		assertThat(this.api.get(folder + "/files/raw?path=" + Api.enc("Family/Recipes/pie.png"), LOGIN, DAD).status())
			.isEqualTo(200);
		assertThat(this.api.get(folder + "/files/raw?path=" + Api.enc("Attachments/photo.png"), LOGIN, DAD)
			.problem(403)).isEqualTo("outside-share");
		JsonNode view = this.api.get(key, LOGIN, MOM).ok(200);
		assertThat(paths(view.get("files"))).containsExactly("Family/Groceries.md");
		assertThat(paths(view.get("embedded"))).containsExactly("Attachments/photo.png");
		assertThat(paths(this.api.get(folder, LOGIN, DAD).ok(200).get("files"))).contains(
				"Family/Recipes/Pie.md", "Family/Recipes/pie.png", "Family/Recipes/Crème.md",
				"Family/Recipes/board.canvas")
			.doesNotContain("Family/Recipes2/Secret.md", "Family/Other.md", "Private/Diary.md",
					"Attachments/secret.png");
	}

	@Test
	void viewSharesRefuseEveryWriteAndEditSharesOnlyTheirNotes() {
		String folder = "/api/s/" + readFolderShare;
		JsonNode pie = this.api.get(folder + "/files?path=" + Api.enc("Family/Recipes/Pie.md"), LOGIN, DAD).ok(200);
		assertThat(this.api
			.putJson(folder + "/files?path=" + Api.enc("Family/Recipes/Pie.md"),
					Map.of("content", "changed", "baseVersion", pie.get("version").asString()), LOGIN, DAD)
			.problem(403)).isEqualTo("share-read-only");
		assertThat(this.api.postJson(folder + "/files", Map.of("path", "Family/Recipes/New.md"), LOGIN, DAD)
			.problem(403)).isEqualTo("share-read-only");

		String edit = "/api/s/" + editFolderShare;
		assertThat(this.api.postJson(edit + "/files", Map.of("path", "Family/Recipes/Cake.md", "content", "# Cake\n"),
				LOGIN, MOM)
			.ok(201)
			.get("file")
			.get("path")
			.asString()).isEqualTo("Family/Recipes/Cake.md");
		// Only Markdown notes, only inside the folder; a note share creates nothing.
		assertThat(this.api.postJson(edit + "/files", Map.of("path", "Family/Recipes/x.canvas"), LOGIN, MOM)
			.problem(403)).isEqualTo("share-read-only");
		assertThat(this.api.postJson(edit + "/files", Map.of("path", "Family/Elsewhere.md"), LOGIN, MOM).problem(403))
			.isEqualTo("outside-share");
		assertThat(this.api.postJson("/api/s/" + noteShare + "/files", Map.of("path", "Family/Groceries2.md"),
				LOGIN, MOM)
			.problem(403)).isEqualTo("outside-share");
		JsonNode board = this.api.get(edit + "/files?path=" + Api.enc("Family/Recipes/board.canvas"), LOGIN, MOM)
			.ok(200);
		assertThat(this.api
			.putJson(edit + "/files?path=" + Api.enc("Family/Recipes/board.canvas"),
					Map.of("content", "{}", "baseVersion", board.get("version").asString()), LOGIN, MOM)
			.problem(403)).isEqualTo("share-read-only");
		// Guests never delete, move, upload or make folders: those are owner endpoints.
		assertThat(this.api.delete("/api/files?path=" + Api.enc("Family/Recipes/Cake.md"), LOGIN, MOM).problem(403))
			.isEqualTo("identity-not-allowed");
		assertThat(Files.exists(vault.resolve("Family/Recipes/Cake.md"))).isTrue();
	}

	@Test
	void aGuestsConflictTellsWhereAMovedNoteWentOnlyInsideTheShare() {
		String edit = "/api/s/" + editFolderShare;
		create("Family/Recipes/Stew.md", "# Stew\n");
		create("Family/Recipes/Broth.md", "# Broth\n");
		String stew = this.api.get(edit + "/files?path=" + Api.enc("Family/Recipes/Stew.md"), LOGIN, MOM)
			.ok(200)
			.get("version")
			.asString();
		String broth = this.api.get(edit + "/files?path=" + Api.enc("Family/Recipes/Broth.md"), LOGIN, MOM)
			.ok(200)
			.get("version")
			.asString();
		// Out of the share, twice: the guest's save answers as for a deleted note, whatever the spelling or version.
		owner().postJson("/api/move", Map.of("from", "Family/Recipes/Stew.md", "to", "Private/Necklace for Mom.md"),
				LOGIN, OWNER)
			.ok(200);
		owner().postJson("/api/move", Map.of("from", "Private/Necklace for Mom.md", "to", "Private/Old/Necklace.md"),
				LOGIN, OWNER)
			.ok(200);
		for (String path : List.of("Family/Recipes/Stew.md", "Family/Recipes/stew.md")) {
			for (String base : List.of(stew, "not-a-real-version")) {
				Reply conflict = this.api.putJson(edit + "/files?path=" + Api.enc(path),
						Map.of("content", "edited\n", "baseVersion", base), LOGIN, MOM);
				assertThat(conflict.problem(409)).as(path).isEqualTo("version-conflict");
				assertThat(conflict.json().get("movedTo").isNull()).as(path).isTrue();
				assertThat(conflict.json().get("currentVersion").isNull()).isTrue();
				assertThat(conflict.text()).doesNotContain("Private/").doesNotContain("Necklace");
			}
		}
		// Inside the share, the guest's page follows the note.
		owner().postJson("/api/move", Map.of("from", "Family/Recipes/Broth.md", "to", "Family/Recipes/Soups/Broth.md"),
				LOGIN, OWNER)
			.ok(200);
		Reply inside = this.api.putJson(edit + "/files?path=" + Api.enc("Family/Recipes/Broth.md"),
				Map.of("content", "edited\n", "baseVersion", broth), LOGIN, MOM);
		assertThat(inside.problem(409)).isEqualTo("version-conflict");
		assertThat(inside.json().get("movedTo").asString()).isEqualTo("Family/Recipes/Soups/Broth.md");
		// The guest page works inside the share only, for an owner who opens it too.
		assertThat(this.api
			.putJson(edit + "/files?path=" + Api.enc("Family/Recipes/Stew.md"),
					Map.of("content", "edited\n", "baseVersion", stew), LOGIN, OWNER)
			.json()
			.get("movedTo")
			.isNull()).isTrue();
	}

	@Test
	void guestsCannotAddEmbedsThatReachOutsideTheShare() {
		String key = "/api/s/" + noteShare;
		String path = "?path=" + Api.enc("Family/Groceries.md");
		JsonNode note = this.api.get(key + "/files" + path, LOGIN, MOM).ok(200);
		String text = note.get("content").asString();
		String version = note.get("version").asString();
		int n = 0;
		// Link holders may edit the note too; each refusal is a fresh login, as refusals count toward the rate limit.
		for (String added : List.of("![[secret.png]]", "![[Diary]]", "![[Private/Diary.md]]", "![[nothing-here.png]]",
				"![x](../Attachments/secret.png)", "![x](Attachments/secret.png)", "![[Family/Other.md]]",
				"![[Secret.png]]")) {
			Reply refused = this.api.putJson("/api/s/" + noteToken + "/files" + path,
					Map.of("content", text + "\n" + added + "\n", "baseVersion", version), LOGIN,
					"linkholder" + (n++) + "@example.com");
			assertThat(refused.problem(403)).as(added).isEqualTo("outside-share");
		}
		// Keeping the embeds it has (the photo, and the owner's unresolved one), and editing around them, is fine.
		JsonNode saved = this.api
			.putJson(key + "/files" + path, Map.of("content", text.replace("milk", "oat milk"), "baseVersion", version),
					LOGIN, MOM)
			.ok(200);
		version = saved.get("file").get("version").asString();
		// Cutting the photo and pasting it back (an undo) works within the grace period.
		String without = text.replace("milk", "oat milk").replace("![[photo.png]]", "");
		version = this.api.putJson(key + "/files" + path, Map.of("content", without, "baseVersion", version), LOGIN, MOM)
			.ok(200)
			.get("file")
			.get("version")
			.asString();
		assertThat(this.api.get(key + "/files/raw?path=" + Api.enc("Attachments/photo.png"), LOGIN, MOM).problem(403))
			.isEqualTo("outside-share");
		this.api.putJson(key + "/files" + path,
				Map.of("content", text.replace("milk", "oat milk"), "baseVersion", version), LOGIN, MOM)
			.ok(200);
		assertThat(this.api.get(key + "/files/raw?path=" + Api.enc("Attachments/photo.png"), LOGIN, MOM).status())
			.isEqualTo(200);
		// A new note in a folder share may embed what is inside the folder only.
		String folder = "/api/s/" + editFolderShare;
		this.api.postJson(folder + "/files", Map.of("path", "Family/Recipes/Tart.md", "content", "![[pie.png]]\n"),
				LOGIN, MOM)
			.ok(201);
		assertThat(this.api
			.postJson(folder + "/files", Map.of("path", "Family/Recipes/Tart2.md", "content", "![[secret.png]]\n"),
					LOGIN, MOM)
			.problem(403)).isEqualTo("outside-share");
		assertThat(Files.exists(vault.resolve("Family/Recipes/Tart2.md"))).isFalse();
		// Refused embeds do not count toward the rate limit: autosave sends the text again after every pause.
		for (int i = 0; i < ShareRateLimiter.MAX_FAILURES + 5; i++) {
			assertThat(this.api
				.putJson("/api/s/" + noteToken + "/files" + path,
						Map.of("content", "![[secret.png]]\n", "baseVersion", "0".repeat(40)), LOGIN, "typist@example.com")
				.problem(403)).isEqualTo("outside-share");
		}
	}

	@Test
	void theRateLimitLocksOutAProbingLoginButNeverAnOwner() {
		String prober = "prober@example.com";
		for (int i = 0; i < ShareRateLimiter.MAX_FAILURES; i++) {
			assertThat(this.api.get("/api/s/" + ShareTokens.newToken(), LOGIN, prober).problem(404))
				.isEqualTo("share-not-found");
		}
		// Locked out, even with a working link, on every guest endpoint.
		Reply locked = this.api.get("/api/s/" + noteToken, LOGIN, prober);
		assertThat(locked.problem(429)).isEqualTo("too-many-attempts");
		assertThat(Long.parseLong(locked.header("Retry-After"))).isBetween(1L, 15 * 60L + 1);
		assertThat(this.api.get("/api/s", LOGIN, prober).problem(429)).isEqualTo("too-many-attempts");
		// Others are not affected; owners are never counted.
		assertThat(this.api.get("/api/s/" + noteToken, LOGIN, "neighbour@example.com").status()).isEqualTo(200);
		for (int i = 0; i < ShareRateLimiter.MAX_FAILURES + 5; i++) {
			assertThat(this.api.get("/api/s/" + ShareTokens.newId(), LOGIN, OWNER).problem(404))
				.isEqualTo("share-not-found");
		}
		assertThat(this.api.get("/api/s/" + noteShare, LOGIN, OWNER).status()).isEqualTo(200);
	}

	// ---------------------------------------------------------------- ending a share

	@Test
	void revokingAShareEndsItAtOnceAndEndsItsStreams() throws Exception {
		JsonNode made = this.api.postJson("/api/shares",
				Map.of("path", "Family/Other.md", "mode", "read", "recipients", List.of("aunt@example.com"), "link", true),
				LOGIN, OWNER)
			.ok(201);
		String id = made.get("share").get("id").asString();
		String token = made.get("link").asString().substring("/s/".length());
		assertThat(this.api.get("/api/s/" + id, LOGIN, "aunt@example.com").status()).isEqualTo(200);
		try (SseRecorder byId = SseRecorder.openPath(this.port, "/api/s/" + id + "/events?clientId=aunt-client-01",
				Map.of(LOGIN, "aunt@example.com"));
				SseRecorder byLink = SseRecorder.openPath(this.port,
						"/api/s/" + token + "/events?clientId=link-client-01", Map.of(LOGIN, "cousin@example.com"))) {
			assertThat(byId.frames().get(0).event()).isEqualTo("hello");
			assertThat(byId.frames().get(0).data().get("resync").asBoolean()).isTrue();
			// A new link ends the old link's stream, not the recipient's.
			Map<String, Object> update = new LinkedHashMap<>();
			update.put("mode", "read");
			update.put("recipients", List.of("aunt@example.com"));
			update.put("link", "new");
			update.put("expiresAt", null);
			JsonNode renewed = this.api.putJson("/api/shares/" + id, update, LOGIN, OWNER).ok(200);
			String newToken = renewed.get("link").asString().substring("/s/".length());
			await().atMost(Duration.ofSeconds(10)).until(byLink::ended);
			assertThat(byId.ended()).isFalse();
			assertThat(this.api.get("/api/s/" + token, LOGIN, "cousin@example.com").problem(404))
				.isEqualTo("share-not-found");
			assertThat(this.api.get("/api/s/" + newToken, LOGIN, "cousin@example.com").status()).isEqualTo(200);
			// Revoking ends everything.
			this.api.delete("/api/shares/" + id, LOGIN, OWNER).ok(204);
			await().atMost(Duration.ofSeconds(10)).until(byId::ended);
			assertThat(this.api.get("/api/s/" + id, LOGIN, "aunt@example.com").problem(404))
				.isEqualTo("share-not-found");
			assertThat(this.api.get("/api/s/" + newToken, LOGIN, "cousin@example.com").problem(404))
				.isEqualTo("share-not-found");
		}
	}

	@Test
	void anExpiredShareAnswersLikeARevokedOneUntilItIsExtended() throws Exception {
		JsonNode made = this.api.postJson("/api/shares", Map.of("path", "Family/Other.md", "mode", "read",
				"recipients", List.of("uncle@example.com"), "expiresAt", "2099-01-01T00:00:00.000Z"), LOGIN, OWNER)
			.ok(201);
		String id = made.get("share").get("id").asString();
		assertThat(made.get("share").get("state").asString()).isEqualTo("active");
		assertThat(this.api.get("/api/s/" + id, LOGIN, "uncle@example.com").status()).isEqualTo(200);
		try (SseRecorder stream = SseRecorder.openPath(this.port, "/api/s/" + id + "/events?clientId=uncle-client-1",
				Map.of(LOGIN, "uncle@example.com"))) {
			// Expire it by hand, as an edit of shares.json would.
			Path file = vault.resolve(".notesapp/shares.json");
			Files.writeString(file, Files.readString(file).replace("2099-01-01T00:00:00.000Z", "2020-01-01T00:00:00.000Z"));
			assertThat(this.api.get("/api/s/" + id, LOGIN, "uncle@example.com").problem(404))
				.isEqualTo("share-not-found");
			await().atMost(Duration.ofSeconds(30)).until(() -> {
				// The next event or heartbeat ends the stream; a file change is an event.
				this.api.putJson("/api/files?path=" + Api.enc("Family/Other.md"),
						Map.of("content", "changed " + System.nanoTime() + "\n", "baseVersion",
								this.api.get("/api/files?path=" + Api.enc("Family/Other.md"), LOGIN, OWNER)
									.ok(200)
									.get("version")
									.asString()),
						LOGIN, OWNER);
				return stream.ended();
			});
		}
		JsonNode listed = this.api.get("/api/shares", LOGIN, OWNER).ok(200);
		JsonNode share = null;
		for (JsonNode candidate : listed.get("shares")) {
			if (candidate.get("id").asString().equals(id)) {
				share = candidate;
			}
		}
		assertThat(share).isNotNull();
		assertThat(share.get("state").asString()).isEqualTo("expired");
		this.api.putJson("/api/shares/" + id, Map.of("mode", "read", "recipients", List.of("uncle@example.com"), "link",
				"keep", "expiresAt", "2099-06-01T00:00:00.000Z"), LOGIN, OWNER).ok(200);
		assertThat(this.api.get("/api/s/" + id, LOGIN, "uncle@example.com").status()).isEqualTo(200);
	}

	// ---------------------------------------------------------------- the stream

	@Test
	void aGuestStreamCarriesOnlyItsShare() throws Exception {
		try (SseRecorder stream = SseRecorder.openPath(this.port,
				"/api/s/" + readFolderShare + "/events?clientId=dad-client-001", Map.of(LOGIN, DAD))) {
			JsonNode hello = stream.frames().get(0).data();
			assertThat(hello.get("resync").asBoolean()).isTrue();
			assertThat(hello.get("replayed").asInt()).isZero();
			// Outside: a private note, a settings save, a bookmark, a share of the owner's. Inside: a recipe.
			create("Private/Later.md", "private\n");
			this.api.putJson("/api/bookmarks", Map.of("items", List.of()), LOGIN, OWNER);
			create("Family/Recipes/Soup.md", "# Soup\n");
			stream.awaitEvent("file.created");
			Set<String> paths = new LinkedHashSet<>();
			for (SseRecorder.Frame frame : stream.frames()) {
				if (frame.event().startsWith("file.")) {
					paths.add(frame.data().get("file").get("path").asString());
				}
				assertThat(frame.event()).isIn("hello", "ping", "file.created", "file.changed");
			}
			assertThat(paths).containsExactly("Family/Recipes/Soup.md");
			// A move out of the folder is not a move the guest may see: it becomes share.changed.
			this.api.postJson("/api/move", Map.of("from", "Family/Recipes/Soup.md", "to", "Private/Soup.md"), LOGIN,
					OWNER)
				.ok(200);
			stream.awaitEvent("share.changed");
			assertThat(stream.frames().stream().map(SseRecorder.Frame::event)).doesNotContain("entry.moved");
			assertThat(stream.frames().toString()).doesNotContain("Private/Soup.md").doesNotContain("Later.md");
		}
	}

	@Test
	void aGuestStreamIsNotAnOpenVoyagerTabForInAppReminders() throws Exception {
		try (SseRecorder stream = SseRecorder.openPath(this.port,
				"/api/s/" + editFolderShare + "/events?clientId=mom-client-002", Map.of(LOGIN, MOM))) {
			assertThat(stream.frames().get(0).event()).isEqualTo("hello");
			JsonNode status = this.api.get("/api/reminders/status", LOGIN, OWNER).ok(200);
			assertThat(status.get("inApp").get("connections").asInt()).isZero();
		}
	}

	private static List<String> paths(JsonNode files) {
		List<String> out = new ArrayList<>();
		files.forEach((file) -> out.add(file.get("path").asString()));
		return out;
	}

}
