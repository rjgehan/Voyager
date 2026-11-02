package com.rjgehan.notes.api;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.rjgehan.notes.history.CommitBatcher;
import com.rjgehan.notes.support.Api;
import com.rjgehan.notes.support.IntegrationProperties;
import com.rjgehan.notes.support.NotesIntegrationTest;
import com.rjgehan.notes.support.TestPdfs;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.client.RestTestClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * Item 22 over HTTP: OR and groups, regular expressions, scopes and PDF text (API.md §12), and the saved searches of an
 * earlier build turned into search bookmarks at startup.
 */
@NotesIntegrationTest
class SearchUpgradesIntegrationTest {

	@TempDir
	static Path vault;

	@DynamicPropertySource
	static void properties(DynamicPropertyRegistry registry) throws IOException {
		// Saved searches as an earlier build left them, before the application starts.
		Files.createDirectories(vault.resolve(".notesapp"));
		Files.writeString(vault.resolve(".notesapp/searches.json"), """
				{ "schemaVersion": 1, "searches": [
				  { "id": "s-open", "name": "Open loops", "query": "tag:#todo -done", "sort": "relevance" } ] }
				""", StandardCharsets.UTF_8);
		IntegrationProperties.register(registry, () -> vault);
	}

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

	private void create(String path, String content) {
		this.api.postJson("/api/files", Map.of("path", path, "content", content)).ok(201);
	}

	private JsonNode search(String query) {
		return this.api.get("/api/search?q=" + Api.enc(query)).ok(200);
	}

	private static List<String> paths(JsonNode response) {
		List<String> paths = new ArrayList<>();
		response.get("results").forEach((hit) -> paths.add(hit.get("path").asString()));
		return paths;
	}

	@Test
	void theRicherQueryLanguage() {
		create("Lang/Cats.md", "I like cats\nand dogs too\n");
		create("Lang/Dogs.md", "I like dogs and cats\n");
		create("Lang/Recipe.md", "# Cake\nmix flour and sugar\n# Notes\nmix later\n");
		assertThat(paths(search("path:lang (cats OR flour) -recipe"))).containsExactlyInAnyOrder("Lang/Cats.md",
				"Lang/Dogs.md");
		assertThat(paths(search("path:lang line:(dogs cats)"))).containsExactly("Lang/Dogs.md");
		assertThat(paths(search("section:(cake flour)"))).containsExactly("Lang/Recipe.md");
		assertThat(paths(search("section:(cake later)"))).isEmpty();
		JsonNode regex = search("/l[io]ke? (cats|dogs)/ path:lang");
		assertThat(paths(regex)).containsExactlyInAnyOrder("Lang/Cats.md", "Lang/Dogs.md");
		JsonNode match = regex.get("results").get(0).get("matches").get(0);
		assertThat(match.get("ranges").get(0).get("from").asInt()).isEqualTo(2);
		assertThat(match.get("page").isNull()).isTrue();
	}

	@Test
	void invalidAndRunawayRegularExpressionsAreBadRequests() {
		create("Regex/Numbers.md", "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28\n");
		Api.Reply invalid = this.api.get("/api/search?q=" + Api.enc("/a(b/"));
		assertThat(invalid.problem(400)).isEqualTo("bad-request");
		assertThat(invalid.json().get("errors").get(0).get("field").asString()).isEqualTo("q");
		assertThat(invalid.json().get("detail").asString()).contains("Invalid regular expression");
		Api.Reply runaway = this.api.get("/api/search?q=" + Api.enc("/(.*?,){30}P/"));
		assertThat(runaway.problem(400)).isEqualTo("bad-request");
		assertThat(runaway.json().get("detail").asString()).contains("took too long");
		assertThat(this.api.get("/api/search?q=" + Api.enc("x".repeat(2001))).problem(400)).isEqualTo("bad-request");
	}

	@Test
	void pdfTextIsSearchableWithItsPage() {
		byte[] pdf = TestPdfs.withPages("Getting started\nInstall the plotter", "Troubleshooting\nPaper jam in tray two");
		this.api.putBytes("/api/files/raw?path=" + Api.enc("Docs/Plotter manual.pdf"), pdf).ok(201);
		await().atMost(Duration.ofSeconds(30)).until(() -> search("paper jam").get("total").asInt() == 1);
		JsonNode hit = search("paper jam").get("results").get(0);
		assertThat(hit.get("path").asString()).isEqualTo("Docs/Plotter manual.pdf");
		assertThat(hit.get("kind").asString()).isEqualTo("pdf");
		assertThat(hit.get("basename").asString()).isEqualTo("Plotter manual");
		JsonNode match = hit.get("matches").get(0);
		assertThat(match.get("page").asInt()).isEqualTo(2);
		assertThat(match.get("text").asString()).isEqualTo("Paper jam in tray two");
		assertThat(paths(search("file:plotter"))).containsExactly("Docs/Plotter manual.pdf");
		assertThat(Files.isDirectory(vault.resolve(".notesapp/cache/search-text"))).isTrue();
		// The text is not part of the note count.
		assertThat(this.api.get("/api/status").ok(200).get("vault").get("notes").asInt()).isEqualTo(
				this.api.get("/api/tree").ok(200).get("files").valueStream().filter((f) -> f.get("kind").asString()
					.equals("note")).count());
	}

	@Test
	void savedSearchesOfAnEarlierBuildAreSearchBookmarksAndTheirApiIsGone() throws Exception {
		JsonNode items = this.api.get("/api/bookmarks").ok(200).get("items");
		assertThat(items.size()).isEqualTo(1);
		assertThat(items.get(0).get("type").asString()).isEqualTo("search");
		assertThat(items.get(0).get("title").asString()).isEqualTo("Open loops");
		assertThat(items.get(0).get("query").asString()).isEqualTo("tag:#todo -done");
		assertThat(vault.resolve(".notesapp/searches.json")).doesNotExist();
		assertThat(Files.readString(vault.resolve(".notesapp/searches.json.migrated"), StandardCharsets.UTF_8))
			.contains("Open loops");
		assertThat(this.api.get("/api/searches").problem(404)).isEqualTo("not-found");
		assertThat(this.api.putJson("/api/searches", Map.of("searches", List.of(), "baseVersion", "")).status())
			.isIn(404, 405);
	}

}
