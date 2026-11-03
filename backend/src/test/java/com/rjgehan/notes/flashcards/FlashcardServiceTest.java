package com.rjgehan.notes.flashcards;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;

import com.rjgehan.notes.api.dto.FlashcardReview;
import com.rjgehan.notes.api.dto.FlashcardWriteResult;
import com.rjgehan.notes.history.Author;
import com.rjgehan.notes.vault.Hashing;
import com.rjgehan.notes.vault.ApiPath;
import com.rjgehan.notes.api.error.NotesException;
import com.rjgehan.notes.support.TestVault;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.node.ObjectNode;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** {@code .notesapp/srs.json} on disk: what a write does to a file that could not be read in full. */
class FlashcardServiceTest {

	@TempDir
	Path dir;

	private TestVault vault;

	private FlashcardService service;

	@BeforeEach
	void start() throws IOException {
		this.vault = TestVault.start(this.dir);
		this.service = new FlashcardService(this.vault.fs, this.vault.index, this.vault.batcher, this.vault.hub,
				TestVault.JSON, this.vault.clock);
	}

	@AfterEach
	void close() {
		this.vault.close();
	}

	private static FlashcardReview review(String card, String at, String rating) {
		return new FlashcardReview(card, at, rating, null, null, null, null, null);
	}

	private Path file() {
		return this.dir.resolve(FlashcardService.FILE);
	}

	private List<Path> backups() throws IOException {
		try (Stream<Path> files = Files.list(this.dir.resolve(".notesapp"))) {
			return files.filter((path) -> path.getFileName().toString().startsWith("srs.json.bak-")).toList();
		}
	}

	private byte[] seedAndBreak(String from, String to) throws IOException {
		this.service.review(List.of(review("a1", "2026-10-14T09:00:00.000Z", "good"),
				review("b2", "2026-10-14T09:01:00.000Z", "easy")), TestVault.ALICE, null);
		ObjectNode config = TestVault.JSON.createObjectNode().put("newPerDay", 15);
		this.service.updateConfig(config, TestVault.ALICE, null);
		String text = Files.readString(file());
		assertThat(text).contains(from);
		byte[] broken = text.replace(from, to).getBytes(StandardCharsets.UTF_8);
		Files.write(file(), broken);
		return broken;
	}

	@Test
	void anAnswerOverAFileThatIsNotJsonKeepsTheBrokenFileBesideIt() throws IOException {
		byte[] broken = seedAndBreak("\"newPerDay\": 15", "\"newPerDay\": 15,");

		// The read stays tolerant: every card looks new until the file is fixed.
		assertThat(this.service.state().cards()).isEmpty();

		this.service.review(List.of(review("c3", "2026-10-15T10:00:00.000Z", "good")), TestVault.ALICE, null);

		assertThat(Files.readString(file())).contains("\"c3\"").doesNotContain("\"a1\"");
		List<Path> backups = backups();
		assertThat(backups).hasSize(1);
		assertThat(Files.readAllBytes(backups.get(0))).isEqualTo(broken);

		// The file is whole again: the next write keeps no second copy.
		this.service.review(List.of(review("c3", "2026-10-15T11:00:00.000Z", "good")), TestVault.ALICE, null);
		assertThat(backups()).hasSize(1);
	}

	@Test
	void aSettingsChangeOverAFileThatIsNotAnObjectKeepsItBesideIt() throws IOException {
		this.service.review(List.of(review("a1", "2026-10-14T09:00:00.000Z", "good")), TestVault.ALICE, null);
		Files.writeString(file(), "[1,2]");

		this.service.updateConfig(TestVault.JSON.createObjectNode().put("fuzz", false), TestVault.ALICE, null);

		List<Path> backups = backups();
		assertThat(backups).hasSize(1);
		assertThat(Files.readString(backups.get(0))).isEqualTo("[1,2]");
	}

	@Test
	void aCardsSectionThatIsNotAnObjectIsKeptBesideTheFile() throws IOException {
		byte[] broken = seedAndBreak("\"cards\": {", "\"cards\": [], \"was\": {");

		this.service.review(List.of(review("c3", "2026-10-15T10:00:00.000Z", "good")), TestVault.ALICE, null);

		List<Path> backups = backups();
		assertThat(backups).hasSize(1);
		assertThat(Files.readAllBytes(backups.get(0))).isEqualTo(broken);
	}

	@Test
	void aWholeFileNeedsNoBackup() throws IOException {
		this.service.review(List.of(review("a1", "2026-10-14T09:00:00.000Z", "good")), TestVault.ALICE, null);
		this.service.review(List.of(review("b2", "2026-10-14T09:01:00.000Z", "good")), TestVault.ALICE, null);

		assertThat(backups()).isEmpty();
	}

	@Test
	void anAnswerRefusedAsBusyIsWrittenWhenItIsRetried() throws IOException {
		this.vault.batcher.beginImport();
		this.vault.batcher.setImportWait(Duration.ofMillis(10));
		this.vault.batcher.markDirty(new ApiPath("other.md", "other.md"), Author.of(TestVault.BOB));
		List<FlashcardReview> answer = List.of(review("c1", "2026-10-15T10:00:00.000Z", "good"));

		assertThatThrownBy(() -> this.service.review(answer, TestVault.ALICE, null)).isInstanceOf(NotesException.class);
		assertThat(file()).doesNotExist();
		assertThat(this.service.state().cards()).doesNotContainKey("c1");

		this.vault.batcher.endImport();
		FlashcardWriteResult retried = this.service.review(answer, TestVault.ALICE, null);
		assertThat(Files.readString(file())).contains("\"c1\"");
		assertThat(retried.version()).isEqualTo(Hashing.blobId(Files.readAllBytes(file())));
	}

}
