package com.rjgehan.notes.history;

import com.rjgehan.notes.ai.UsageLedger;
import com.rjgehan.notes.reminders.ReminderScheduler;
import com.rjgehan.notes.vault.TrashStore;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** The app's state files outside {@code .notesapp/cache/} are kept out of history by the managed exclude (§4.6). */
class GitExcludeTest {

	@Test
	void theAppsStateFilesAreNeverCommitted() {
		assertThat(GitStore.EXCLUDE.lines()).contains(UsageLedger.FILE, ReminderScheduler.FILE, TrashStore.METADATA);
	}

}
