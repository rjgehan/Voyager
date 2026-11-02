package com.rjgehan.notes.index;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import com.rjgehan.notes.api.dto.FileKind;
import com.rjgehan.notes.vault.Hashing;
import com.rjgehan.notes.vault.PathNames;
import com.rjgehan.notes.vault.TextCodec;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Snippets found through the index's kept token sequences ({@link SnippetBuilder}, {@link VaultIndex#bodies}) are
 * exactly those of tokenizing every line: for words, prefixes, phrases, typo variants and alternatives, over notes
 * with frontmatter, CRLF line ends, accents, ideographs, combining marks, encrypted sections and PDF pages.
 */
class SnippetSequenceTest {

	private static final String[] WORDS = { "alpha", "beta", "gamma", "delta", "café", "Cafe", "naïve", "über", "東京",
			"日本語", "éclair", "x1", "2026", "co-op", "foo_bar", "MATCH", "match", "matching", "matchbox" };

	private static final String LOCK = "🔐";

	private final VaultIndex index = new VaultIndex();

	private void note(String path, String text, int minute) {
		NoteParse parse = MarkdownScanner.scan(text, false, false);
		byte[] bytes = TextCodec.encode(text, false);
		FileRecord record = new FileRecord(path, IndexFixtures.KINDS.kindOf(path), bytes.length,
				Instant.parse("2026-10-16T12:00:00Z").plusSeconds(60L * minute), Hashing.blobId(bytes),
				parse.aliases());
		this.index.put(new IndexedFile(record, path, text, parse));
	}

	private void pdf(String path, String text) {
		FileRecord record = new FileRecord(path, FileKind.PDF, 1000, Instant.parse("2026-10-16T12:00:00Z"), null,
				List.of());
		this.index.put(new IndexedFile(record, path, null, null));
		NoteParse parse = PdfTextIndexer.parseOf(text);
		String basename = PathNames.basenameOf(PathNames.nameOf(path));
		assertThat(this.index.putExtracted(record, text, parse, SearchIndex.Doc.of(basename, text, parse))).isTrue();
	}

	private static String randomNote(Random random) {
		StringBuilder text = new StringBuilder();
		if (random.nextBoolean()) {
			text.append("---\ntags: [alpha]\ntitle: match\n---\n");
		}
		int lines = 1 + random.nextInt(40);
		String eol = random.nextInt(4) == 0 ? "\r\n" : "\n";
		for (int l = 0; l < lines; l++) {
			int words = random.nextInt(12);
			for (int w = 0; w < words; w++) {
				text.append(WORDS[random.nextInt(WORDS.length)]).append(random.nextInt(5) == 0 ? ", " : " ");
			}
			if (random.nextInt(15) == 0) {
				text.append("%%" + LOCK + "α c2VjcmV0IG1hdGNo " + LOCK + "%% match");
			}
			text.append(eol);
		}
		return text.toString();
	}

	private void assertSameSnippets(String query, boolean fuzzy) {
		VaultIndex.SearchOutcome outcome = this.index.search(SearchQueryParser.parse(query),
				new VaultIndex.SearchOptions(true, fuzzy, (path) -> false, false, Duration.ofSeconds(30)));
		List<SearchIndex.Body> bodies = this.index.bodies(outcome.hits());
		for (int i = 0; i < outcome.hits().size(); i++) {
			VaultIndex.SearchHit hit = outcome.hits().get(i);
			NoteRecord note = hit.note();
			String basename = PathNames.basenameOf(PathNames.nameOf(note.path()));
			boolean paged = hit.kind() == FileKind.PDF;
			SnippetBuilder.Snippets tokenized = SnippetBuilder.build(basename, note.searchText(), note.parse(),
					outcome.patterns(), outcome.regexes(), outcome.budget(), paged, null);
			SnippetBuilder.Snippets sequenced = SnippetBuilder.build(basename, note.searchText(), note.parse(),
					outcome.patterns(), outcome.regexes(), outcome.budget(), paged, bodies.get(i));
			assertThat(bodies.get(i)).as("kept body of %s", note.path()).isNotNull();
			assertThat(sequenced).as("%s in %s", query, note.path()).isEqualTo(tokenized);
		}
	}

	@Test
	void sequencedSnippetsEqualTokenizedOnes() {
		Random random = new Random(7);
		for (int i = 0; i < 150; i++) {
			note("Notes/N" + i + ".md", randomNote(random), i);
		}
		note("Long.md", "match\n".repeat(50) + "alpha beta\n", 200);
		pdf("Docs/Manual.pdf", "Getting started alpha\nInstall match" + PdfText.PAGE_BREAK + "match again\n"
				+ "beta gamma" + PdfText.PAGE_BREAK + "the end match");
		List<String> queries = new ArrayList<>(List.of("match", "alpha beta", "\"alpha beta\"", "matc", "cafe",
				"eclair", "東京", "日本", "naive uber", "co op", "foo_bar", "2026", "match -gamma",
				"alpha OR gamma", "(beta OR delta) match", "\"gamma delta\" alph", "x1 match", "machbox", "alfa"));
		for (String query : queries) {
			assertSameSnippets(query, false);
			assertSameSnippets(query, true);
		}
	}

	@Test
	void aDocumentChangedSinceTheSearchGetsNoBody() {
		note("a.md", "match here\n", 0);
		VaultIndex.SearchOutcome outcome = this.index.search(SearchQueryParser.parse("match"), true, (p) -> false,
				false);
		note("a.md", "match changed\n", 1);
		assertThat(this.index.bodies(outcome.hits())).containsExactly((SearchIndex.Body) null);
		outcome = this.index.search(SearchQueryParser.parse("match"), true, (p) -> false, false);
		assertThat(this.index.bodies(outcome.hits())).singleElement().isNotNull();
	}

	@Test
	void regularExpressionsStillReadTheText() {
		note("a.md", "alpha match\nnothing\nmatch again\n", 0);
		VaultIndex.SearchOutcome outcome = this.index.search(SearchQueryParser.parse("/mat.h/"), true, (p) -> false,
				false);
		VaultIndex.SearchHit hit = outcome.hits().get(0);
		SnippetBuilder.Snippets snippets = SnippetBuilder.build("a", hit.note().searchText(), hit.note().parse(),
				outcome.patterns(), outcome.regexes(), outcome.budget(), false,
				this.index.bodies(outcome.hits()).get(0));
		assertThat(snippets.matches()).hasSize(2);
	}

}
