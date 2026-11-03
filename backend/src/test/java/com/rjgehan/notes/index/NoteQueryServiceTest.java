package com.rjgehan.notes.index;

import java.time.Duration;
import java.util.List;

import com.rjgehan.notes.api.dto.NoteTask;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;

/** The checkbox tasks a note query returns ({@code GET /api/notes/query?tasks=true}). */
class NoteQueryServiceTest {

	@Test
	void tasksInListsQuotesAndFencesAreFoundAsBefore() {
		List<NoteTask> tasks = NoteQueryService.tasks("""
				- [ ] open
				  1. [x] done
				> - [ ] quoted
				>> * [X] nested quote
				+ [-] cancelled\r
				- [ ]
				-[ ] no space
				```
				- [ ] in a fence
				```
				""");
		assertThat(tasks).extracting(NoteTask::line, NoteTask::status, NoteTask::done, NoteTask::text)
			.containsExactly(org.assertj.core.groups.Tuple.tuple(0, " ", false, "open"),
					org.assertj.core.groups.Tuple.tuple(1, "x", true, "done"),
					org.assertj.core.groups.Tuple.tuple(2, " ", false, "quoted"),
					org.assertj.core.groups.Tuple.tuple(3, "X", true, "nested quote"),
					org.assertj.core.groups.Tuple.tuple(4, "-", false, "cancelled"));
	}

	@Test
	void aLongBlankLineTakesLinearTime() {
		assertTimeoutPreemptively(Duration.ofMillis(500), () -> {
			assertThat(NoteQueryService.tasks(" ".repeat(32_000) + "x")).isEmpty();
			assertThat(NoteQueryService.tasks("\t".repeat(32_000))).isEmpty();
			assertThat(NoteQueryService.tasks("- [ ]" + " ".repeat(32_000) + "\u2028x")).hasSize(1);
		});
	}

	@Test
	void aLongRunOfQuoteMarkersNeverOverflowsTheStack() {
		assertThat(NoteQueryService.tasks(">".repeat(10_000) + " plain text\n- [ ] real"))
			.extracting(NoteTask::line, NoteTask::text)
			.containsExactly(org.assertj.core.groups.Tuple.tuple(1, "real"));
		assertThat(NoteQueryService.tasks("> ".repeat(5_000) + "- [ ] deep")).singleElement()
			.satisfies((task) -> assertThat(task.text()).isEqualTo("deep"));
	}

}
