package com.rjgehan.notes.index;

import java.time.Duration;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

/** Inline Meld Encrypt sections (ROADMAP item 27): blanked for search, replaced for Ask your vault. */
class EncryptedSectionsTest {

	private static final String LOCK = "🔐";

	private static final String HINT = "💡";

	@Test
	void everyPrefixAndBothSuffixesAreFound() {
		String b64 = "QUJDREVGR0hJSktMTU5PUA==";
		String hidden = "%%" + LOCK + "β " + HINT + "my cat" + HINT + "QUJD+/==QUJDREVGR0hJ " + LOCK + "%%";
		String visible = LOCK + "β " + b64 + " " + LOCK;
		String alpha = "%%" + LOCK + "α " + b64 + " " + LOCK + "%%";
		String obsolete = "%%" + LOCK + " " + b64 + " " + LOCK + "%%";
		String text = "a " + hidden + " b " + visible + " c " + alpha + " d " + obsolete + " e";
		assertThat(EncryptedSections.strip(text)).isEqualTo("a [encrypted] b [encrypted] c [encrypted] d [encrypted] e");
	}

	@Test
	void blankingKeepsEveryOffset() {
		String section = "%%" + LOCK + "β " + HINT + "h" + HINT + "U2VjcmV0U2VjcmV0 " + LOCK + "%%";
		String text = "line one\nsecret: " + section + " end\nline three";
		String blank = EncryptedSections.blank(text);
		assertThat(blank).hasSameSizeAs(text);
		assertThat(blank).isEqualTo("line one\nsecret: " + " ".repeat(section.length()) + " end\nline three");
	}

	@Test
	void textWithoutSectionsIsReturnedAsIs() {
		String text = "Nothing " + LOCK + " here but a lock emoji " + LOCK + ".";
		assertThat(EncryptedSections.blank(text)).isSameAs(text);
		assertThat(EncryptedSections.strip("plain")).isSameAs("plain");
		// Words between two lock emoji are not a section, nor is a short or unmarked visible one.
		assertThat(EncryptedSections.strip(text)).isEqualTo(text);
		String unmarked = LOCK + " QUJDREVGR0hJSktMTU5PUA== " + LOCK + " and " + LOCK + "β QUJD " + LOCK;
		assertThat(EncryptedSections.strip(unmarked)).isSameAs(unmarked);
	}

	@Test
	void aLineOfHintMarkersIsScannedInLinearTime() {
		// The hint ends at the next 💡 (a hint never holds one, as in the editor's meld.ts): a lazy [^\n]*? tried
		// every later 💡 of the line from every section start, quadratic on a long line.
		String commented = ("%%" + LOCK + "β " + HINT).repeat(20_000);
		String visible = (LOCK + "β " + HINT + "x").repeat(20_000);
		assertTimeoutPreemptively(Duration.ofSeconds(3), () -> {
			assertThat(EncryptedSections.blank(commented)).isSameAs(commented);
			assertThat(EncryptedSections.ranges(visible, true)).isEmpty();
			assertThat(EncryptedSections.strip(commented + visible)).isEqualTo(commented + visible);
		});
		// A hint still works; text with a 💡 inside it is not a hint, so that is no section (as in the editor).
		String b64 = "QUJDREVGR0hJSktMTU5PUA==";
		assertThat(EncryptedSections.ranges("%%" + LOCK + "β " + HINT + "my hint" + HINT + b64 + " " + LOCK + "%%", false))
			.hasSize(1);
		assertThat(EncryptedSections.ranges("%%" + LOCK + "β " + HINT + "a" + HINT + "b" + HINT + b64 + " " + LOCK + "%%",
				false))
			.isEmpty();
	}

	@Test
	void aSectionNeverSpansLines() {
		String text = "%%" + LOCK + "β QUJDREVGR0hJSktMTU5P\nQUJDREVGR0hJSktMTU5P " + LOCK + "%%";
		assertThat(EncryptedSections.blank(text)).isSameAs(text);
	}

	@Test
	void encryptedNotesAreTextThatIsNeverContentIndexed() {
		assertThat(IndexFixtures.KINDS.kindOf("Safe/Bank.mdenc")).isEqualTo(com.rjgehan.notes.api.dto.FileKind.TEXT);
		assertThat(IndexFixtures.KINDS.kindOf("Safe/Bank.MDENC")).isEqualTo(com.rjgehan.notes.api.dto.FileKind.TEXT);
	}

	@Test
	void searchNeverMatchesCiphertextButFindsTheRest() {
		VaultIndex index = new VaultIndex();
		String text = "Bank details %%" + LOCK + "β " + HINT + "usual" + HINT + "U2VjcmV0UGF5bG9hZA== " + LOCK
				+ "%% stored safely\n";
		NoteParse parse = MarkdownScanner.scan(text, false, false);
		byte[] bytes = com.rjgehan.notes.vault.TextCodec.encode(text, false);
		FileRecord record = new FileRecord("Bank.md", IndexFixtures.KINDS.kindOf("Bank.md"), bytes.length,
				java.time.Instant.parse("2026-10-21T12:00:00Z"), com.rjgehan.notes.vault.Hashing.blobId(bytes),
				parse.aliases());
		index.put(new IndexedFile(record, "Bank.md", text, parse));
		assertThat(hits(index, "U2VjcmV0UGF5bG9hZA")).isEmpty();
		assertThat(hits(index, "/U2Vj/")).isEmpty();
		assertThat(hits(index, "usual")).isEmpty();
		assertThat(hits(index, "line:(bank stored)")).containsExactly("Bank.md");
		assertThat(hits(index, "safely")).containsExactly("Bank.md");
	}

	private static java.util.List<String> hits(VaultIndex index, String query) {
		return index
			.search(SearchQueryParser.parse(query),
					new VaultIndex.SearchOptions(true, false, (path) -> false, false, java.time.Duration.ofSeconds(10)))
			.hits()
			.stream()
			.map((hit) -> hit.note().path())
			.toList();
	}

}
