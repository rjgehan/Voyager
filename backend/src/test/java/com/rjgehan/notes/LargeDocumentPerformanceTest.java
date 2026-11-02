package com.rjgehan.notes;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import com.rjgehan.notes.index.MarkdownScanner;
import com.rjgehan.notes.index.NoteParse;
import com.rjgehan.notes.support.Api;
import com.rjgehan.notes.support.RunningApp;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.JsonNode;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The large-document targets of DESIGN §5.19 (docs/PERFORMANCE.md): a 5 MB note among 2,000 others is scanned,
 * searched and saved within bounds, asserted with the 3× margin of {@link VaultPerformanceTest}. Before the fixes
 * these measured about 900 ms (scan), 130 to 400 ms (a search finding the note: its snippets tokenized all of it) and
 * 900 ms (a save). Excluded from the default build; run it with
 * {@code ./mvnw test -Dtest=LargeDocumentPerformanceTest -DexcludedGroups=}.
 */
@Tag("perf")
class LargeDocumentPerformanceTest {

	private static final int MARGIN = 3;

	private static final String[] WORDS = ("garden river lantern orbit meadow copper signal harbor velvet thunder "
			+ "compass ember fable glacier hollow island juniper kettle ledger marble nectar oasis pepper quartz "
			+ "ribbon saffron timber umbra vessel willow yonder zephyr anchor beacon cobalt drift echo falcon granite")
		.split(" ");

	@TempDir
	Path vault;

	/** About 5 MB of everything a note can hold: headings, lists, tables, callouts, code, tasks, footnotes. */
	static String bigNote() {
		Random random = new Random(42);
		Supplier<String> words = () -> {
			StringBuilder out = new StringBuilder();
			for (int i = 0; i < 8; i++) {
				out.append(WORDS[random.nextInt(WORDS.length)]).append(' ');
			}
			return out.toString().strip();
		};
		StringBuilder text = new StringBuilder("---\ntags: [big]\n---\n# Big Note\n\n");
		for (int block = 0; text.length() < 5_000_000; block++) {
			switch (block % 8) {
				case 0 -> text.append("## Chapter ").append(block).append("\n\n").append(words.get())
					.append(". See [[Note ").append(random.nextInt(2000)).append("]].\n\n");
				case 1 -> text.append("- ").append(words.get()).append(" **bold** *it* `code`\n- ")
					.append(words.get()).append("\n\n");
				case 2 -> text.append("| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n| ").append(words.get())
					.append(" | 5 | 6 |\n\n");
				case 3 -> text.append("> [!note] Callout\n> ").append(words.get()).append("\n\n");
				case 4 -> text.append("```python\ndef f(x):\n    return x * ").append(block).append("\n```\n\n");
				case 5 -> text.append("- [ ] ").append(words.get()).append(" #task\n- [x] done\n\n");
				case 6 -> text.append(words.get()).append(" $x^2$ ==mark==, footnote[^").append(block)
					.append("].\n\n[^").append(block).append("]: ").append(words.get()).append("\n\n");
				default -> text.append(words.get()).append(' ').append(words.get()).append(".\n\n");
			}
			if (block % 997 == 0) {
				// A rare pair of words, as a search for something specific in the note finds it.
				text.append("The zephyrquill met the nimbuscrate here.\n\n");
			}
		}
		return text.toString();
	}

	private static long millis(Runnable action) {
		long start = System.nanoTime();
		action.run();
		return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
	}

	private static long median(int warmup, int runs, Runnable action) {
		for (int i = 0; i < warmup; i++) {
			action.run();
		}
		List<Long> samples = new ArrayList<>();
		for (int i = 0; i < runs; i++) {
			samples.add(millis(action));
		}
		return samples.stream().sorted().toList().get(runs / 2);
	}

	private static void report(String what, long measured, long target) {
		System.out.printf("PERF %-45s %6d (target %d, limit %d)%n", what, measured, target, target * MARGIN);
		assertThat(measured).as("%s (target %d)", what, target).isLessThanOrEqualTo(target * MARGIN);
	}

	@Test
	void scanningAFiveMegabyteNote() {
		String text = bigNote();
		NoteParse[] parse = new NoteParse[1];
		report("scan of a 5 MB note (median)", median(3, 5, () -> parse[0] = MarkdownScanner.scan(text, false, false)),
				200);
		assertThat(parse[0].links()).hasSizeGreaterThan(1000);
		assertThat(parse[0].headings()).hasSizeGreaterThan(1000);
	}

	@Test
	void searchingAndSavingAFiveMegabyteNote() throws IOException {
		Files.createDirectories(this.vault.resolve("Big"));
		Files.writeString(this.vault.resolve("Big/Big Note.md"), bigNote(), StandardCharsets.UTF_8);
		for (int i = 0; i < 2000; i++) {
			String extra = (i % 100 == 0) ? "The zephyrquill and the nimbuscrate.\n" : "";
			Files.writeString(this.vault.resolve("Note " + i + ".md"), "# Note " + i + "\n\nSome " + WORDS[i % WORDS.length]
					+ " text about " + WORDS[(i * 7) % WORDS.length] + ".\n" + extra, StandardCharsets.UTF_8);
		}
		try (RunningApp app = RunningApp.start(this.vault, Map.of("notes.welcome-note", "false"))) {
			Api api = app.api();
			String query = "/api/search?q=" + Api.enc("zephyrquill nimbuscrate") + "&prefix=true&fuzzy=true";
			JsonNode found = api.get(query).ok(200);
			assertThat(found.get("total").asInt()).isEqualTo(21);
			report("search finding the 5 MB note (median)", median(3, 9, () -> api.get(query).ok(200)), 30);

			String path = "/api/files?path=" + Api.enc("Big/Big Note.md");
			JsonNode file = api.get(path).ok(200);
			String content = file.get("content").asString();
			String[] version = { file.get("version").asString() };
			int[] n = { 0 };
			report("save of the 5 MB note (median)", median(2, 5, () -> version[0] = api
				.putJson(path, Map.of("content", content + "\nEdit " + (n[0]++) + "\n", "baseVersion", version[0]))
				.ok(200)
				.get("file")
				.get("version")
				.asString()), 400);
		}
	}

}
