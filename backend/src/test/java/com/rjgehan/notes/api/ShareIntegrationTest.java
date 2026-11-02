package com.rjgehan.notes.api;

import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.rjgehan.notes.history.CommitBatcher;
import com.rjgehan.notes.support.Api;
import com.rjgehan.notes.support.Api.Reply;
import com.rjgehan.notes.support.IntegrationProperties;
import com.rjgehan.notes.support.NotesIntegrationTest;
import com.rjgehan.notes.support.SseRecorder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.client.RestTestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * Sharing with family as the owner and the family use it (ROADMAP item 42, DESIGN §5.40, API.md §42): the owner's API,
 * the landing page, a guest's edits with the version protocol and as history's author, shares following moves, and
 * live updates on a guest's stream. Requests without a login are the owner's (the dev profile's default identity).
 */
@NotesIntegrationTest
class ShareIntegrationTest {

	private static final String LOGIN = "Tailscale-User-Login";

	private static final String NAME = "Tailscale-User-Name";

	private static final String MOM = "mom@example.com";

	@TempDir
	static Path vault;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) {
		IntegrationProperties.register(registry, () -> vault,
				Map.of("notes.identity.allowed-logins", "owner@example.com"));
	}

	@LocalServerPort
	int port;

	@Autowired
	RestTestClient client;

	@Autowired
	CommitBatcher batcher;

	private Api api;

	@BeforeEach
	void setUp() {
		this.api = new Api(this.client);
		await().atMost(Duration.ofSeconds(30)).until(() -> !this.batcher.isImporting());
	}

	private JsonNode create(String path, String content) {
		return this.api.postJson("/api/files", Map.of("path", path, "content", content)).ok(201);
	}

	private JsonNode share(String path, String mode, List<String> recipients, boolean link) {
		return this.api.postJson("/api/shares",
				Map.of("path", path, "mode", mode, "recipients", recipients, "link", link)).ok(201);
	}

	@Test
	void theOwnerMakesListsChangesAndRevokesShares() {
		create("Lists/Packing.md", "- [ ] passports\n");
		JsonNode empty = this.api.get("/api/shares").ok(200);
		assertThat(empty.get("available").asBoolean()).isTrue();
		assertThat(empty.get("reason").isNull()).isTrue();

		JsonNode made = share("Lists/Packing.md", "read", List.of(MOM), true);
		String id = made.get("share").get("id").asString();
		assertThat(made.get("link").asString()).matches("/s/[A-Za-z0-9_-]{43}");
		assertThat(made.get("share").get("url").asString()).isEqualTo("/s/" + id);
		assertThat(made.get("share").get("createdBy").asString()).isEqualTo("owner@notes");
		JsonNode listed = this.api.get("/api/shares").ok(200).get("shares").get(0);
		assertThat(listed.get("id").asString()).isEqualTo(id);
		assertThat(listed.get("hasLink").asBoolean()).isTrue();
		assertThat(listed.toString()).doesNotContain(made.get("link").asString().substring(3));

		Map<String, Object> update = new LinkedHashMap<>();
		update.put("mode", "edit");
		update.put("recipients", List.of(MOM, "dad@example.com"));
		update.put("link", "none");
		update.put("expiresAt", "2099-01-01T00:00:00.000Z");
		JsonNode changed = this.api.putJson("/api/shares/" + id, update).ok(200);
		assertThat(changed.get("link").isNull()).isTrue();
		assertThat(changed.get("share").get("mode").asString()).isEqualTo("edit");
		assertThat(changed.get("share").get("hasLink").asBoolean()).isFalse();
		assertThat(changed.get("share").get("expiresAt").asString()).isEqualTo("2099-01-01T00:00:00.000Z");

		// Validation answers as documented (API.md §42.2).
		assertThat(this.api.postJson("/api/shares", Map.of("path", "Lists/Packing.md", "mode", "read")).problem(400))
			.isEqualTo("bad-request");
		assertThat(this.api.postJson("/api/shares", Map.of("path", "Lists/Nothing.md", "mode", "read", "link", true))
			.problem(404)).isEqualTo("not-found");
		assertThat(this.api.postJson("/api/shares", Map.of("path", "Lists/Packing.md", "mode", "admin", "link", true))
			.problem(400)).isEqualTo("bad-request");
		assertThat(this.api.putJson("/api/shares/nosuchshare1", update).problem(404)).isEqualTo("not-found");

		try (SseRecorder owner = SseRecorder.open(this.port, "other-tab-0001", null)) {
			this.api.delete("/api/shares/" + id).ok(204);
			owner.awaitEvent("shares.changed");
		}
		assertThat(this.api.get("/api/shares").ok(200).get("shares").toString()).doesNotContain(id);
		assertThat(this.api.delete("/api/shares/" + id).problem(404)).isEqualTo("not-found");
	}

	@Test
	void theLandingPageListsWhatIsSharedWithThisLogin() {
		create("Landing/Trip.md", "x\n");
		create("Landing/Gifts/Ideas.md", "x\n");
		share("Landing/Trip.md", "edit", List.of("aunt@example.com"), false);
		share("Landing/Gifts", "read", List.of("Aunt@Example.com", "uncle@example.com"), false);
		share("Landing/Trip.md", "read", List.of("uncle@example.com"), true);
		JsonNode aunt = this.api.get("/api/s", LOGIN, "aunt@example.com", NAME, "=?utf-8?q?T=C3=ADa?=").ok(200);
		assertThat(aunt.get("login").asString()).isEqualTo("aunt@example.com");
		assertThat(aunt.get("name").asString()).isEqualTo("Tía");
		assertThat(aunt.get("shares")).hasSize(2);
		List<String> titles = aunt.get("shares").valueStream().map((s) -> s.get("title").asString()).toList();
		assertThat(titles).containsExactlyInAnyOrder("Trip", "Gifts");
		JsonNode first = aunt.get("shares").get(0);
		assertThat(first.get("vault").isNull()).isTrue();
		assertThat(first.get("url").asString()).startsWith("/s/");
		assertThat(first.get("sharedBy").asString()).isEqualTo("Owner");
		assertThat(this.api.get("/api/s", LOGIN, "nobody@example.com").ok(200).get("shares")).isEmpty();
	}

	@Test
	void aGuestEditsWithTheVersionProtocolAndIsHistorysAuthor() {
		create("Family/Groceries.md", "- [ ] milk\n");
		String id = share("Family/Groceries.md", "edit", List.of(MOM), false).get("share").get("id").asString();
		String key = "/api/s/" + id + "/files?path=" + Api.enc("Family/Groceries.md");
		JsonNode note = this.api.get(key, LOGIN, MOM, NAME, "Mom").ok(200);
		String base = note.get("version").asString();
		JsonNode saved = this.api
			.putJson(key, Map.of("content", "- [x] milk\n- [ ] eggs\n", "baseVersion", base), LOGIN, MOM, NAME, "Mom")
			.ok(200);
		assertThat(saved.get("file").get("path").asString()).isEqualTo("Family/Groceries.md");
		// A save from an older version is a conflict, with the current text (in the share by construction).
		Reply conflict = this.api.putJson(key, Map.of("content", "- [ ] bread\n", "baseVersion", base), LOGIN, MOM);
		assertThat(conflict.problem(409)).isEqualTo("version-conflict");
		assertThat(conflict.json().get("currentContent").asString()).contains("eggs");
		// The commit is the guest's.
		this.api.postEmpty("/api/history/commit").ok(200);
		JsonNode history = this.api.get("/api/history?path=" + Api.enc("Family/Groceries.md")).ok(200);
		JsonNode last = history.get("entries").get(0);
		assertThat(last.get("authorLogin").asString()).isEqualTo(MOM);
		assertThat(last.get("authorName").asString()).isEqualTo("Mom");
		assertThat(this.api.get("/api/files?path=" + Api.enc("Family/Groceries.md")).ok(200).get("content").asString())
			.isEqualTo("- [x] milk\n- [ ] eggs\n");
	}

	@Test
	void sharesFollowRenamesAndTheirGuestsSeeLiveChanges() throws Exception {
		create("Kids/Chores.md", "- [ ] dishes\n");
		String id = share("Kids/Chores.md", "edit", List.of(MOM), false).get("share").get("id").asString();
		try (SseRecorder stream = SseRecorder.openPath(this.port, "/api/s/" + id + "/events?clientId=mom-client-001",
				Map.of(LOGIN, MOM))) {
			JsonNode hello = stream.frames().get(0).data();
			assertThat(hello.get("resync").asBoolean()).isTrue();
			JsonNode current = this.api.get("/api/files?path=" + Api.enc("Kids/Chores.md")).ok(200);
			this.api.putJson("/api/files?path=" + Api.enc("Kids/Chores.md"),
					Map.of("content", "- [x] dishes\n", "baseVersion", current.get("version").asString())).ok(200);
			stream.awaitEvent("file.changed");
			this.api.postJson("/api/move", Map.of("from", "Kids/Chores.md", "to", "Kids/Jobs.md")).ok(200);
			stream.awaitEvent("entry.moved");
			JsonNode moved = stream.frames()
				.stream()
				.filter((f) -> f.event().equals("entry.moved"))
				.findFirst()
				.orElseThrow()
				.data();
			assertThat(moved.get("to").asString()).isEqualTo("Kids/Jobs.md");
		}
		// The address still works and shows the new name.
		JsonNode view = this.api.get("/api/s/" + id, LOGIN, MOM).ok(200);
		assertThat(view.get("path").asString()).isEqualTo("Kids/Jobs.md");
		assertThat(view.get("title").asString()).isEqualTo("Jobs");
		assertThat(this.api.get("/api/s/" + id + "/files?path=" + Api.enc("Kids/Jobs.md"), LOGIN, MOM).status())
			.isEqualTo(200);
		assertThat(this.api.get("/api/s/" + id + "/files?path=" + Api.enc("Kids/Chores.md"), LOGIN, MOM).problem(403))
			.isEqualTo("outside-share");
		// A deleted note leaves the share, missing, and guests get not-found for the file.
		this.api.delete("/api/files?path=" + Api.enc("Kids/Jobs.md")).ok(200);
		JsonNode listed = this.api.get("/api/shares").ok(200);
		assertThat(listed.get("shares").valueStream().filter((s) -> s.get("id").asString().equals(id)).findFirst()
			.orElseThrow()
			.get("state")
			.asString()).isEqualTo("missing");
		assertThat(this.api.get("/api/s/" + id + "/files?path=" + Api.enc("Kids/Jobs.md"), LOGIN, MOM).problem(404))
			.isEqualTo("not-found");
		assertThat(this.api.get("/api/s/" + id, LOGIN, MOM).ok(200).get("files")).isEmpty();
	}

}
