package com.rjgehan.notes.startup;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class WelcomeContentTest {

	/**
	 * A note shows its lines as typed (DESIGN §6.6.1), and Obsidian's reading view renders single line breaks as
	 * {@code <br>}, so a paragraph or list item wrapped in the source would show its sentences broken mid-line.
	 */
	@Test
	void everyParagraphAndListItemIsOneLine() throws Exception {
		List<String> lines = welcome().lines().toList();
		int body = lines.subList(1, lines.size()).indexOf("---") + 2;
		for (int i = body + 1; i < lines.size(); i++) {
			String line = lines.get(i);
			String previous = lines.get(i - 1);
			if (line.isBlank() || previous.isBlank()) {
				continue;
			}
			// Only list items, table rows, headings and the lines of a quote (a callout) may sit on adjacent lines.
			assertThat(line).as("line %d continues line %d", i + 1, i).matches("^(- |\\||#|> ).*");
			assertThat(previous).as("line %d is followed by line %d", i, i + 1).matches("^(- |\\||#|> ).*");
		}
	}

	/** The tour points to the user guide built into the app (DESIGN §6.45) by the names of its entries. */
	@Test
	void pointsToTheBuiltInGuide() throws Exception {
		String text = welcome();
		assertThat(text).startsWith("---\ntags: [welcome]\n---\n# Welcome to Voyager\n");
		assertThat(text).contains("**Help**", "☰ › Help", "⋯ › Help", "Help › **Writing**");
	}

	private static String welcome() throws Exception {
		return new String(new WelcomeContent().bytes(), StandardCharsets.UTF_8);
	}

}
